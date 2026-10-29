// Worksheet part -> cells, merges, extents (PLAN §5).
// Reads <c r t s> with <f t="shared|array|dataTable" si ref>, <v>, <is>; <mergeCells>.
// Formula cells are counted against the shared formula budget as they are read (each shared
// child has its own <f>, so the count is "after expansion") and the cap aborts the read.

import { parseA1, parseRangeA1, toA1, toCellRef, isValidRow, MAX_COL, type Range } from '../util/addr.ts';
import { GateError } from './gateError.ts';
import { expandSharedFormula, markArrayMembers, type SharedFormulaMaster } from './sharedFormulas.ts';
import { richText } from './sharedStrings.ts';
import type { Styles } from './styles.ts';
import { opaqueCategories, tokenize } from './tokenizer.ts';
import { tokensToR1C1, type SheetNameResolver } from './r1c1.ts';
import type { CachedType, CachedValue, Cell, CellOpaqueCategory, OpaqueEntry } from './types.ts';
import { attr, child, children, decodeOoxmlEscapes, textOf, type XNode } from './xml.ts';

export interface FormulaBudget {
  count: number;
  readonly max: number;
}

export interface WorksheetContext {
  readonly sheetName: string;
  readonly partName: string;
  readonly sharedStrings: readonly string[];
  readonly styles: Styles;
  readonly formulaBudget: FormulaBudget;
  /** Maps formula sheet prefixes to the workbook's own sheet-name spelling (R1C1 form). */
  readonly resolveSheet?: SheetNameResolver;
}

export interface ParsedWorksheet {
  cells: Map<string, Cell>;
  merges: Range[];
  maxRow: number;
  maxCol: number;
  /** Formula cells on this sheet. */
  formulaCells: number;
  opaque: OpaqueEntry[];
  notes: string[];
}

interface CachedResult {
  type: CachedType;
  value: CachedValue;
}

const NONE: CachedResult = { type: 'none', value: null };

function cachedValueOf(c: XNode, t: string, ctx: WorksheetContext, noteOnce: (key: string, text: string) => void): CachedResult {
  const vNode = child(c, 'v');
  const v = vNode ? textOf(vNode) : undefined;
  switch (t) {
    case 's': {
      if (v === undefined || v.trim() === '') return NONE;
      const idx = Number(v);
      if (!Number.isInteger(idx) || idx < 0 || idx >= ctx.sharedStrings.length) {
        noteOnce('bad-sst', `Sheet "${ctx.sheetName}": a shared-string index is out of range; that cell is treated as having no value.`);
        return NONE;
      }
      return { type: 's', value: ctx.sharedStrings[idx] };
    }
    case 'str':
      return v === undefined ? NONE : { type: 'str', value: decodeOoxmlEscapes(v) };
    case 'inlineStr': {
      const is = child(c, 'is');
      if (is) return { type: 'inlineStr', value: richText(is) };
      return v === undefined ? NONE : { type: 'inlineStr', value: decodeOoxmlEscapes(v) };
    }
    case 'b':
      if (v === '1' || v === 'true') return { type: 'b', value: true };
      if (v === '0' || v === 'false') return { type: 'b', value: false };
      return NONE;
    case 'e':
      return v === undefined || v.trim() === '' ? NONE : { type: 'e', value: v.trim() };
    case 'd':
      // Strict-OOXML ISO date cells have no serial number; kept as text.
      noteOnce('iso-date', `Sheet "${ctx.sheetName}": ISO-date cells (t="d") are kept as text.`);
      return v === undefined ? NONE : { type: 'str', value: v };
    default: {
      if (v === undefined || v.trim() === '') return NONE;
      const n = Number(v);
      if (Number.isFinite(n)) return { type: 'n', value: n };
      noteOnce('bad-number', `Sheet "${ctx.sheetName}": a numeric cell holds non-numeric text; kept as text.`);
      return { type: 'str', value: v };
    }
  }
}

interface SharedChild {
  cell: Cell;
  si: string | undefined;
}

export function parseWorksheet(doc: XNode, ctx: WorksheetContext): ParsedWorksheet {
  const ws = child(doc, 'worksheet');
  if (!ws) {
    throw new GateError('bad-xml', `Part "${ctx.partName}" has no <worksheet> root.`, { part: ctx.partName });
  }
  const cells = new Map<string, Cell>();
  const notes: string[] = [];
  const noted = new Set<string>();
  const noteOnce = (key: string, text: string): void => {
    if (noted.has(key)) return;
    noted.add(key);
    notes.push(text);
  };

  const masters = new Map<string, SharedFormulaMaster>();
  const sharedChildren: SharedChild[] = [];
  const arrays: Cell[] = [];
  const formulaCells: Cell[] = [];

  // A repeated cell address: the later cell wins, so the earlier one must leave every work list
  // (formula count and budget, shared children, shared masters, arrays) or it would be a ghost.
  const forget = (prev: Cell): void => {
    const removeFrom = <T>(list: T[], match: (item: T) => boolean): boolean => {
      const i = list.findIndex(match);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    };
    if (removeFrom(formulaCells, (c) => c === prev)) ctx.formulaBudget.count--;
    removeFrom(arrays, (c) => c === prev);
    removeFrom(sharedChildren, (s) => s.cell === prev);
    for (const [si, m] of masters) {
      if (m.row === prev.row && m.col === prev.col) masters.delete(si);
    }
  };

  let rowCursor = 0;
  for (const rowNode of children(child(ws, 'sheetData'), 'row')) {
    const rAttr = attr(rowNode, 'r');
    const rowNum = rAttr !== undefined ? Number(rAttr) : rowCursor + 1;
    if (!isValidRow(rowNum)) {
      noteOnce('bad-row', `Sheet "${ctx.sheetName}": a row with an invalid number was skipped.`);
      continue;
    }
    rowCursor = rowNum;
    let colCursor = 0;
    for (const c of children(rowNode, 'c')) {
      const ref = attr(c, 'r');
      let row = rowNum;
      let col: number;
      if (ref !== undefined) {
        const p = parseA1(ref);
        if (!p) {
          noteOnce('bad-ref', `Sheet "${ctx.sheetName}": a cell with an invalid address was skipped.`);
          continue;
        }
        row = p.row;
        col = p.col;
      } else {
        col = colCursor + 1;
      }
      colCursor = col;
      if (col > MAX_COL) continue;

      const fNode = child(c, 'f');
      const t = attr(c, 't') ?? 'n';
      const cached = cachedValueOf(c, t, ctx, noteOnce);
      if (!fNode && cached.type === 'none') continue; // style-only placeholder

      const sAttr = attr(c, 's');
      const styleId = sAttr !== undefined && /^\d+$/.test(sAttr) ? Number(sAttr) : undefined;
      const fmt = ctx.styles.cellFormat(styleId);
      const addr = toA1(row, col);
      const previous = cells.get(addr);
      if (previous) {
        noteOnce('dup-cell', `Sheet "${ctx.sheetName}": a cell address appears twice; the later one is used.`);
        forget(previous);
      }
      const cell: Cell = {
        addr,
        row,
        col,
        cachedType: cached.type,
        cachedValue: cached.value,
        numFmtId: fmt.numFmtId,
        isPercentFmt: fmt.isPercent,
        isDateFmt: fmt.isDate,
      };
      if (styleId !== undefined) cell.styleId = styleId;
      if (fmt.numFmtCode !== undefined) cell.numFmtCode = fmt.numFmtCode;

      if (fNode) {
        ctx.formulaBudget.count++;
        if (ctx.formulaBudget.count > ctx.formulaBudget.max) {
          throw new GateError(
            'too-many-formulas',
            `The workbook has more than ${ctx.formulaBudget.max} formula cells (counted after shared-formula expansion).`,
            { limit: ctx.formulaBudget.max },
          );
        }
        const ft = attr(fNode, 't') ?? 'normal';
        const text = textOf(fNode);
        if (ft === 'shared') {
          cell.formulaKind = 'shared';
          const si = attr(fNode, 'si');
          if (text.trim() !== '') {
            cell.formula = text;
            // The master carries the text (and normally `ref`). Some writers repeat the text on
            // children; any text-bearing cell is valid at its own position, so the first wins.
            if (si !== undefined && !masters.has(si)) masters.set(si, { row, col, formula: text });
          } else {
            sharedChildren.push({ cell, si });
          }
        } else if (ft === 'array') {
          cell.formulaKind = 'array';
          cell.formula = text;
          cell.arrayRef = attr(fNode, 'ref') ?? addr;
          arrays.push(cell);
        } else if (ft === 'dataTable') {
          cell.formulaKind = 'dataTable';
          cell.opaque = ['data-table'];
        } else {
          cell.formulaKind = 'normal';
          cell.formula = text;
        }
        formulaCells.push(cell);
      }

      cells.set(addr, cell);
    }
  }

  // Shared children: re-base the master by token shift.
  for (const { cell, si } of sharedChildren) {
    const master = si === undefined ? undefined : masters.get(si);
    if (!master) {
      cell.opaque = ['unresolved-shared'];
      noteOnce('orphan-shared', `Sheet "${ctx.sheetName}": a shared formula has no master formula; it is treated as opaque.`);
      continue;
    }
    const expanded = expandSharedFormula(master, cell.row, cell.col);
    cell.formula = expanded.formula;
    if (expanded.outOfBounds) {
      noteOnce('shared-oob', `Sheet "${ctx.sheetName}": a shared formula expands past the sheet edge (shown as #REF!).`);
    }
  }

  // Array formulas: mark every stored cell inside `ref`.
  for (const anchor of arrays) {
    const range = parseRangeA1(anchor.arrayRef ?? anchor.addr);
    if (!range) {
      anchor.inArray = true;
      noteOnce('bad-array-ref', `Sheet "${ctx.sheetName}": an array formula has an invalid range.`);
      continue;
    }
    anchor.inArray = true;
    markArrayMembers(cells, anchor, range);
  }

  // Tokenize every formula once: opaque categories and the R1C1 form.
  const opaque: OpaqueEntry[] = [];
  let missingCache = 0;
  for (const cell of formulaCells) {
    if (cell.cachedType === 'none') missingCache++;
    const cats: CellOpaqueCategory[] = cell.opaque ? [...cell.opaque] : [];
    if (cell.formula !== undefined) {
      const tokens = tokenize(cell.formula);
      for (const cat of opaqueCategories(tokens)) {
        if (!cats.includes(cat)) cats.push(cat);
      }
      cell.r1c1 = tokensToR1C1(tokens, cell, ctx.resolveSheet);
    }
    if (cats.length > 0) {
      cell.opaque = cats;
      const ref = toCellRef(ctx.sheetName, cell.row, cell.col);
      for (const category of cats) opaque.push({ cell: ref, category });
    }
  }
  if (missingCache > 0) {
    notes.push(
      `Sheet "${ctx.sheetName}": ${missingCache} formula cell(s) have no cached value (unknown, not zero); rules that need cached values skip them.`,
    );
  }

  const merges: Range[] = [];
  for (const m of children(child(ws, 'mergeCells'), 'mergeCell')) {
    const r = parseRangeA1(attr(m, 'ref') ?? '');
    if (r) merges.push(r);
  }

  let maxRow = 0;
  let maxCol = 0;
  for (const cell of cells.values()) {
    if (cell.row > maxRow) maxRow = cell.row;
    if (cell.col > maxCol) maxCol = cell.col;
  }

  return { cells, merges, maxRow, maxCol, formulaCells: formulaCells.length, opaque, notes };
}

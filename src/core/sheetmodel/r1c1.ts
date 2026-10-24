// R1C1 normalisation and token-based re-basing of relative references (PLAN §5).
//
// toR1C1: relative refs become R[dr]C[dc] (R / C when the offset is 0), absolute R5C2, mixed
// accordingly, for cells, areas, whole columns and whole rows; sheet prefixes are kept in the
// canonical quoted form; function/name/boolean/error text is upper-cased; whitespace is dropped
// except the intersection operator (one space). Two cells hold "the same formula copied" exactly
// when their R1C1 strings are equal.
//
// rebaseFormula: shift every relative reference by (dRow, dCol), absolute parts unchanged, by
// rewriting only the reference tokens' spans of the source text (never string substitution on
// the whole formula, so string literals and names are untouched). Out-of-sheet results become
// `#REF!` (keeping any sheet prefix), as Excel does.

import { colToLetters, isValidCol, isValidRow, quoteSheetName } from '../util/addr.ts';
import { tokenTarget, tokenize, type CellPart, type LinePart, type RefTarget, type Token } from './tokenizer.ts';

export interface Anchor {
  row: number;
  col: number;
}

function rel(offset: number): string {
  return offset === 0 ? '' : `[${offset}]`;
}

export function cellPartToR1C1(c: CellPart, anchor: Anchor): string {
  const r = c.rowAbs ? String(c.row) : rel(c.row - anchor.row);
  const k = c.colAbs ? String(c.col) : rel(c.col - anchor.col);
  return `R${r}C${k}`;
}

export function targetToR1C1(t: RefTarget, anchor: Anchor): string {
  switch (t.type) {
    case 'cell':
      return cellPartToR1C1(t.cell, anchor);
    case 'area':
      return `${cellPartToR1C1(t.from, anchor)}:${cellPartToR1C1(t.to, anchor)}`;
    case 'cols': {
      const f = (p: LinePart): string => `C${p.abs ? String(p.index) : rel(p.index - anchor.col)}`;
      return `${f(t.from)}:${f(t.to)}`;
    }
    case 'rows': {
      const f = (p: LinePart): string => `R${p.abs ? String(p.index) : rel(p.index - anchor.row)}`;
      return `${f(t.from)}:${f(t.to)}`;
    }
  }
}

const R1C1_CELL_RE = /^R(?:\[(-?\d+)\]|(\d+))?C(?:\[(-?\d+)\]|(\d+))?$/;

/** Parse a single R1C1 cell reference relative to `anchor` back to an A1 CellPart. */
export function parseR1C1Cell(text: string, anchor: Anchor): CellPart | null {
  const m = R1C1_CELL_RE.exec(text);
  if (!m) return null;
  const relRow = m[1] as string | undefined;
  const absRow = m[2] as string | undefined;
  const relCol = m[3] as string | undefined;
  const absCol = m[4] as string | undefined;
  const row = absRow !== undefined ? Number(absRow) : anchor.row + Number(relRow ?? '0');
  const col = absCol !== undefined ? Number(absCol) : anchor.col + Number(relCol ?? '0');
  if (!isValidRow(row) || !isValidCol(col)) return null;
  return { row, col, rowAbs: absRow !== undefined, colAbs: absCol !== undefined };
}

function plainPrefix(sheet: string | undefined): string {
  return sheet === undefined ? '' : `${quoteSheetName(sheet)}!`;
}

function tokenR1C1(t: Token, anchor: Anchor): string {
  switch (t.kind) {
    case 'ref':
      return plainPrefix(t.sheet) + cellPartToR1C1(t.cell, anchor);
    case 'range':
      return `${plainPrefix(t.sheet)}${cellPartToR1C1(t.from, anchor)}:${cellPartToR1C1(t.to, anchor)}`;
    case 'opaque':
      if (t.target) {
        const pre = t.category === 'whole-column' || t.category === 'whole-row' ? plainPrefix(t.sheet) : t.prefix;
        return pre + targetToR1C1(t.target, anchor);
      }
      return t.text;
    case 'name':
      return plainPrefix(t.sheet) + t.name.toUpperCase();
    case 'err':
      return plainPrefix(t.sheet) + t.value;
    case 'func':
      return t.name;
    case 'bool':
      return t.value ? 'TRUE' : 'FALSE';
    case 'num':
      return t.text.toUpperCase();
    case 'op':
      return t.text.trim() === '' ? ' ' : t.text;
    case 'str':
    case 'paren':
    case 'comma':
      return t.text;
  }
}

/** R1C1 form of already-tokenized formula text, relative to the cell that holds it. */
export function tokensToR1C1(tokens: readonly Token[], anchor: Anchor): string {
  let out = '';
  for (const t of tokens) out += tokenR1C1(t, anchor);
  return out;
}

/** R1C1 form of formula text (no `=` in the output), relative to the cell that holds it. */
export function toR1C1(formula: string, anchor: Anchor): string {
  return tokensToR1C1(tokenize(formula), anchor);
}

// ---------------------------------------------------------------------------------------------

export function shiftCellPart(c: CellPart, dRow: number, dCol: number): CellPart | null {
  const row = c.rowAbs ? c.row : c.row + dRow;
  const col = c.colAbs ? c.col : c.col + dCol;
  if (!isValidRow(row) || !isValidCol(col)) return null;
  return { row, col, rowAbs: c.rowAbs, colAbs: c.colAbs };
}

function shiftLine(p: LinePart, delta: number, valid: (n: number) => boolean): LinePart | null {
  const index = p.abs ? p.index : p.index + delta;
  return valid(index) ? { index, abs: p.abs } : null;
}

export function shiftTarget(t: RefTarget, dRow: number, dCol: number): RefTarget | null {
  switch (t.type) {
    case 'cell': {
      const cell = shiftCellPart(t.cell, dRow, dCol);
      return cell ? { type: 'cell', cell } : null;
    }
    case 'area': {
      const from = shiftCellPart(t.from, dRow, dCol);
      const to = shiftCellPart(t.to, dRow, dCol);
      return from && to ? { type: 'area', from, to } : null;
    }
    case 'cols': {
      const from = shiftLine(t.from, dCol, isValidCol);
      const to = shiftLine(t.to, dCol, isValidCol);
      return from && to ? { type: 'cols', from, to } : null;
    }
    case 'rows': {
      const from = shiftLine(t.from, dRow, isValidRow);
      const to = shiftLine(t.to, dRow, isValidRow);
      return from && to ? { type: 'rows', from, to } : null;
    }
  }
}

export function formatCellPart(c: CellPart): string {
  return `${c.colAbs ? '$' : ''}${colToLetters(c.col)}${c.rowAbs ? '$' : ''}${c.row}`;
}

/** A1 text of a reference target (`$B$2`, `A1:B3`, `$A:C`, `2:$5`). */
export function formatTarget(t: RefTarget): string {
  switch (t.type) {
    case 'cell':
      return formatCellPart(t.cell);
    case 'area':
      return `${formatCellPart(t.from)}:${formatCellPart(t.to)}`;
    case 'cols':
      return `${t.from.abs ? '$' : ''}${colToLetters(t.from.index)}:${t.to.abs ? '$' : ''}${colToLetters(t.to.index)}`;
    case 'rows':
      return `${t.from.abs ? '$' : ''}${t.from.index}:${t.to.abs ? '$' : ''}${t.to.index}`;
  }
}

function prefixOf(t: Token): string {
  return t.kind === 'ref' || t.kind === 'range' || t.kind === 'opaque' ? t.prefix : '';
}

export interface RebaseResult {
  /** Re-based formula text (same leading `=` and spacing as the input). */
  formula: string;
  /** True when at least one reference left the sheet and became `#REF!`. */
  outOfBounds: boolean;
}

/** Shift relative references by (dRow, dCol) through the tokenizer (shared formulas, fixes). */
export function rebaseFormula(formula: string, dRow: number, dCol: number): RebaseResult {
  if (dRow === 0 && dCol === 0) return { formula, outOfBounds: false };
  let out = '';
  let pos = 0;
  let outOfBounds = false;
  for (const t of tokenize(formula)) {
    const target = tokenTarget(t);
    if (!target) continue;
    const shifted = shiftTarget(target, dRow, dCol);
    const prefix = prefixOf(t);
    let replacement: string;
    if (shifted) {
      replacement = prefix + formatTarget(shifted);
    } else {
      replacement = `${prefix}#REF!`;
      outOfBounds = true;
    }
    out += formula.slice(pos, t.start) + replacement;
    pos = t.end;
  }
  out += formula.slice(pos);
  return { formula: out, outOfBounds };
}

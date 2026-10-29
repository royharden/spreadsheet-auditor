// readWorkbook(bytes, limits?) -> WorkbookModel (PLAN §4, §5).
// Gate (zipGate) -> [Content_Types].xml macro refusal -> root rels -> workbook.xml (sheet cap)
// -> workbook rels -> shared strings, styles -> worksheets (formula cap) -> external links
// (listed by target, never followed) -> defined names -> coverage.
// Pure: no DOM, no network; throws GateError for every refusal.

import { rangeContains, toA1 } from '../util/addr.ts';
import { parseWorksheet, type FormulaBudget } from './cells.ts';
import { GateError } from './gateError.ts';
import { resolveLimits, type Limits } from './limits.ts';
import {
  CONTENT_TYPES_PART,
  ROOT_RELS_PART,
  assertNoMacroContentTypes,
  parseContentTypes,
  parseRels,
  parseWorkbook,
  relsPartFor,
  type Relationship,
} from './parts.ts';
import { sheetNameResolver } from './r1c1.ts';
import { parseSharedStrings } from './sharedStrings.ts';
import { parseStyles } from './styles.ts';
import type { Cell, DefinedName, OpaqueEntry, Sheet, WorkbookModel } from './types.ts';
import { parseXmlPart, type XNode } from './xml.ts';
import { openZip } from './zipGate.ts';

export interface ReadOptions {
  /** Original file name; when given, anything but `.xlsx` is refused by extension. */
  fileName?: string;
}

const DEFAULT_WORKBOOK_PART = 'xl/workbook.xml';

function firstInternal(rels: readonly Relationship[], typeSuffix: string): string | null {
  for (const r of rels) {
    if (r.typeSuffix === typeSuffix && !r.external && r.partName) return r.partName;
  }
  return null;
}

/** Read and audit-prepare one .xlsx. Throws GateError on any refusal or cap. */
export function readWorkbook(bytes: Uint8Array, limits?: Partial<Limits>, options?: ReadOptions): WorkbookModel {
  const lim = resolveLimits(limits);
  const zip = openZip(bytes, lim, options?.fileName);

  const readXml = (name: string): XNode => parseXmlPart(zip.read(name), name);
  const readXmlIfPresent = (name: string | null): XNode | null => (name !== null && zip.has(name) ? readXml(name) : null);

  if (!zip.has(CONTENT_TYPES_PART)) {
    throw new GateError('missing-part', `The package has no ${CONTENT_TYPES_PART}; it is not an .xlsx workbook.`, {
      part: CONTENT_TYPES_PART,
    });
  }
  assertNoMacroContentTypes(parseContentTypes(readXml(CONTENT_TYPES_PART)));

  const rootRels = parseRels(readXmlIfPresent(ROOT_RELS_PART), '');
  const workbookPart = firstInternal(rootRels, 'officeDocument') ?? DEFAULT_WORKBOOK_PART;
  if (!zip.has(workbookPart)) {
    throw new GateError('missing-part', 'The package has no workbook part; it is not an .xlsx workbook.', {
      part: workbookPart,
    });
  }
  const wb = parseWorkbook(readXml(workbookPart));
  if (wb.sheets.length > lim.maxSheets) {
    throw new GateError('too-many-sheets', `The workbook has ${wb.sheets.length} sheets; the limit is ${lim.maxSheets}.`, {
      sheets: wb.sheets.length,
      limit: lim.maxSheets,
    });
  }

  const wbRels = parseRels(readXmlIfPresent(relsPartFor(workbookPart)), workbookPart);
  const relById = new Map(wbRels.map((r) => [r.id, r] as const));
  const sharedStrings = parseSharedStrings(readXmlIfPresent(firstInternal(wbRels, 'sharedStrings')));
  const styles = parseStyles(readXmlIfPresent(firstInternal(wbRels, 'styles')));

  const notes: string[] = [];
  const opaque: OpaqueEntry[] = [];
  const budget: FormulaBudget = { count: 0, max: lim.maxFormulaCells };
  const sheets: Sheet[] = [];
  const resolveSheet = sheetNameResolver(wb.sheets.map((s) => s.name));

  wb.sheets.forEach((entry, index) => {
    const rel = entry.relId !== undefined ? relById.get(entry.relId) : undefined;
    if (!rel || rel.external || !rel.partName || !zip.has(rel.partName)) {
      notes.push(`Sheet "${entry.name}" has no readable part; it was not analysed.`);
      return;
    }
    if (rel.typeSuffix !== 'worksheet') {
      notes.push(`Sheet "${entry.name}" is a ${rel.typeSuffix}, not a worksheet; it was not analysed.`);
      return;
    }
    const parsed = parseWorksheet(readXml(rel.partName), {
      sheetName: entry.name,
      partName: rel.partName,
      sharedStrings,
      styles,
      formulaBudget: budget,
      resolveSheet,
    });
    notes.push(...parsed.notes);
    opaque.push(...parsed.opaque);
    sheets.push({
      name: entry.name,
      index,
      hidden: entry.state !== 'visible',
      state: entry.state,
      cells: parsed.cells,
      merges: parsed.merges,
      maxRow: parsed.maxRow,
      maxCol: parsed.maxCol,
    });
  });

  // External links: the externalLink part's own rels name the external file. Never followed.
  const externalLinks: string[] = [];
  const addLink = (target: string): void => {
    if (!externalLinks.includes(target)) externalLinks.push(target);
  };
  const linkRels = [
    ...wb.externalReferenceRelIds.flatMap((id) => {
      const r = relById.get(id);
      return r ? [r] : [];
    }),
    ...wbRels.filter((r) => r.typeSuffix === 'externalLink' && !wb.externalReferenceRelIds.includes(r.id)),
  ];
  for (const rel of linkRels) {
    if (rel.external || !rel.partName) {
      addLink(rel.target);
      continue;
    }
    const partRels = parseRels(readXmlIfPresent(relsPartFor(rel.partName)), rel.partName);
    const targets = partRels.filter((r) => r.external).map((r) => r.target);
    if (targets.length === 0) addLink(rel.partName);
    for (const t of targets) addLink(t);
  }
  if (externalLinks.length > 0) {
    notes.push(`The workbook links to ${externalLinks.length} external workbook(s); they are listed, never opened.`);
  }

  const definedNames: DefinedName[] = wb.definedNames.map((d) => {
    const out: DefinedName = { name: d.name, formula: d.formula, hidden: d.hidden };
    if (d.localSheetId !== undefined) {
      out.localSheetId = d.localSheetId;
      const scope = wb.sheets[d.localSheetId];
      if (scope) out.scopeSheet = scope.name;
    }
    return out;
  });

  return {
    sheets,
    definedNames,
    externalLinks,
    coverage: { formulaCells: budget.count, opaque, skippedRules: [], notes },
    date1904: wb.date1904,
  };
}

// ---------------------------------------------------------------------------------------------
// Small lookup helpers for rules (M2+).

/** Sheet by name (case-insensitive, as Excel compares sheet names). */
export function findSheet(model: WorkbookModel, name: string): Sheet | undefined {
  const key = name.toLowerCase();
  return model.sheets.find((s) => s.name.toLowerCase() === key);
}

/** Cell at (row, col), or undefined when out of bounds or not stored. */
export function cellAt(sheet: Sheet, row: number, col: number): Cell | undefined {
  if (row < 1 || col < 1) return undefined;
  try {
    return sheet.cells.get(toA1(row, col));
  } catch {
    return undefined;
  }
}

/** True for any cell backed by an <f> element (including data tables and unresolved shared children). */
export function isFormulaCell(cell: Cell): boolean {
  return cell.formulaKind !== undefined;
}

/** True when the cell lies inside a merged range but is not that range's top-left anchor. */
export function isMergedNonAnchor(sheet: Sheet, row: number, col: number): boolean {
  return sheet.merges.some(
    (m) => rangeContains(m, row, col) && !(m.start.row === row && m.start.col === col),
  );
}

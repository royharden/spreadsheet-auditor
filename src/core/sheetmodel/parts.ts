// OPC package plumbing: [Content_Types].xml (with the macro refusal), relationships,
// part-name resolution, and workbook.xml (sheets, states, defined names, external references).

import { GateError } from './gateError.ts';
import { attr, child, children, textOf, type XNode } from './xml.ts';

export const CONTENT_TYPES_PART = '[Content_Types].xml';
export const ROOT_RELS_PART = '_rels/.rels';

export interface ContentTypes {
  /** Lower-case extension -> content type. */
  readonly defaults: ReadonlyMap<string, string>;
  /** Lower-case part name without leading `/` -> content type. */
  readonly overrides: ReadonlyMap<string, string>;
}

export function parseContentTypes(doc: XNode): ContentTypes {
  const types = child(doc, 'Types');
  if (!types) {
    throw new GateError('bad-xml', `${CONTENT_TYPES_PART} has no <Types> root.`, { part: CONTENT_TYPES_PART });
  }
  const defaults = new Map<string, string>();
  for (const d of children(types, 'Default')) {
    const ext = attr(d, 'Extension');
    const ct = attr(d, 'ContentType');
    if (ext !== undefined && ct !== undefined) defaults.set(ext.toLowerCase(), ct);
  }
  const overrides = new Map<string, string>();
  for (const o of children(types, 'Override')) {
    const name = attr(o, 'PartName');
    const ct = attr(o, 'ContentType');
    if (name !== undefined && ct !== undefined) overrides.set(name.replace(/^\/+/, '').toLowerCase(), ct);
  }
  return { defaults, overrides };
}

/** Content types that mean macros (VBA, XLM macro sheets, macro-enabled workbooks/templates/add-ins). */
const MACRO_CONTENT_TYPE_RE = /macroenabled|vbaproject|vbadata|macrosheet/i;

export function isMacroContentType(contentType: string): boolean {
  return MACRO_CONTENT_TYPE_RE.test(contentType);
}

/** Refuse any Default or Override declaring a macro content type. */
export function assertNoMacroContentTypes(ct: ContentTypes): void {
  for (const [key, type] of [...ct.defaults, ...ct.overrides]) {
    if (isMacroContentType(type)) {
      throw new GateError(
        'macro-content-type',
        'The package declares macro content (a macro-enabled workbook or VBA project); only macro-free .xlsx is supported.',
        { contentType: type, part: key },
      );
    }
  }
}

export interface Relationship {
  readonly id: string;
  /** Full relationship type URI. */
  readonly type: string;
  /** Last path segment of the type URI, e.g. `worksheet`, `sharedStrings`, `externalLink`. */
  readonly typeSuffix: string;
  /** Target exactly as written (for external targets this is what the report lists). */
  readonly target: string;
  readonly external: boolean;
  /** Resolved package part name for internal targets; null for external or unresolvable ones. */
  readonly partName: string | null;
}

/** `xl/workbook.xml` -> `xl/_rels/workbook.xml.rels`. */
export function relsPartFor(partName: string): string {
  const i = partName.lastIndexOf('/');
  const dir = i >= 0 ? partName.slice(0, i + 1) : '';
  const base = partName.slice(i + 1);
  return `${dir}_rels/${base}.rels`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolve a relationship target against its source part (`''` for the package root).
 * Absolute targets start at the package root. Returns null if the path climbs above the root.
 */
export function resolveTarget(sourcePart: string, target: string): string | null {
  const segs = target.startsWith('/') ? [] : sourcePart.split('/').slice(0, -1).filter((s) => s.length > 0);
  for (const raw of target.replace(/^\/+/, '').split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      if (segs.length === 0) return null;
      segs.pop();
      continue;
    }
    segs.push(safeDecode(raw));
  }
  return segs.length > 0 ? segs.join('/') : null;
}

export function parseRels(doc: XNode | null, sourcePart: string): Relationship[] {
  if (!doc) return [];
  const root = child(doc, 'Relationships');
  const out: Relationship[] = [];
  for (const r of children(root, 'Relationship')) {
    const id = attr(r, 'Id');
    const type = attr(r, 'Type');
    const target = attr(r, 'Target');
    if (id === undefined || type === undefined || target === undefined) continue;
    const external = (attr(r, 'TargetMode') ?? 'Internal').toLowerCase() === 'external';
    out.push({
      id,
      type,
      typeSuffix: type.slice(type.lastIndexOf('/') + 1),
      target,
      external,
      partName: external ? null : resolveTarget(sourcePart, target),
    });
  }
  return out;
}

export type SheetState = 'visible' | 'hidden' | 'veryHidden';

export interface WorkbookSheetEntry {
  readonly name: string;
  readonly sheetId: string;
  readonly state: SheetState;
  readonly relId: string | undefined;
}

export interface RawDefinedName {
  readonly name: string;
  readonly formula: string;
  readonly localSheetId: number | undefined;
  readonly hidden: boolean;
}

export interface WorkbookInfo {
  readonly sheets: readonly WorkbookSheetEntry[];
  readonly definedNames: readonly RawDefinedName[];
  /** Relationship ids of <externalReference> elements, in order ([1], [2], ... in formulas). */
  readonly externalReferenceRelIds: readonly string[];
  readonly date1904: boolean;
}

function relIdOf(node: XNode): string | undefined {
  // removeNSPrefix turns r:id into id; keep the prefixed form as a fallback.
  return attr(node, 'id') ?? attr(node, 'r:id');
}

function isTrue(v: string | undefined): boolean {
  return v === '1' || v === 'true';
}

export function parseWorkbook(doc: XNode): WorkbookInfo {
  const wb = child(doc, 'workbook');
  if (!wb) {
    throw new GateError('bad-xml', 'workbook.xml has no <workbook> root.', { part: 'workbook.xml' });
  }
  const sheets: WorkbookSheetEntry[] = children(child(wb, 'sheets'), 'sheet').map((s, i) => {
    const st = attr(s, 'state');
    const state: SheetState = st === 'hidden' ? 'hidden' : st === 'veryHidden' ? 'veryHidden' : 'visible';
    return {
      name: attr(s, 'name') ?? `Sheet${i + 1}`,
      sheetId: attr(s, 'sheetId') ?? String(i + 1),
      state,
      relId: relIdOf(s),
    };
  });
  const definedNames: RawDefinedName[] = children(child(wb, 'definedNames'), 'definedName').flatMap((d) => {
    const name = attr(d, 'name');
    if (name === undefined) return [];
    const local = attr(d, 'localSheetId');
    const localSheetId = local !== undefined && /^\d+$/.test(local) ? Number(local) : undefined;
    return [{ name, formula: textOf(d), localSheetId, hidden: isTrue(attr(d, 'hidden')) }];
  });
  const externalReferenceRelIds = children(child(wb, 'externalReferences'), 'externalReference').flatMap((e) => {
    const id = relIdOf(e);
    return id === undefined ? [] : [id];
  });
  const date1904 = isTrue(attr(child(wb, 'workbookPr'), 'date1904'));
  return { sheets, definedNames, externalReferenceRelIds, date1904 };
}

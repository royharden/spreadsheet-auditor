// Evidence bundle builder (PLAN §4, §7, §2 #13, #16).
//
// Required evidence = the flagged cell + every cell the rule's template cites + facts + labels.
// Optional evidence = stored neighbours on the rule's axis, at most 4 per side, added nearest
// first and alternating sides, while utf8(canonicalJson(bundle)) stays <= 2,048 bytes (a side
// stops at its first neighbour that does not fit, so each side stays contiguous). Required
// evidence is never truncated: when it alone exceeds the budget, there is no Bundle, only a
// TemplateEvidence (flagged cell + facts) and the finding is not model-eligible.
// The bundle's `sha256` is the hash of its canonical JSON without the `sha256` field.

import { cellAt, findSheet } from '../sheetmodel/model.ts';
import type { CachedType, CachedValue, Cell, Sheet, WorkbookModel } from '../sheetmodel/types.ts';
import type { Facts, Finding } from '../rules/types.ts';
import { isValidCol, isValidRow, parseA1, splitCellRef, toCellRef, type CellRef } from '../util/addr.ts';
import { canonicalJson, utf8ByteLength } from '../util/canonicalJson.ts';
import { sha256Hex } from '../util/sha256.ts';
import { sanitizeText, sanitizeValue } from './sanitize.ts';
import { MAX_BUNDLE_BYTES } from '../explain/limits.ts';

export const BUNDLE_MAX_BYTES = MAX_BUNDLE_BYTES;
export const MAX_NEIGHBOURS_PER_SIDE = 4;
/** How far labels are searched (cells above for the column label, left for the row label). */
export const LABEL_SCAN_LIMIT = 200;

/** One cell as sent: formula (with `=`), cached type, cached value, number-format code. */
export interface BundleCell {
  f?: string;
  t: CachedType;
  v: CachedValue;
  fmt?: string;
}

export interface BundleLabels {
  /** Nearest text to the left in the flagged cell's row. */
  row?: string;
  /** Nearest text above in the flagged cell's column (its header). */
  col?: string;
}

export interface Bundle {
  findingId: string;
  /** sha256 hex of canonicalJson(bundle without `sha256`). */
  sha256: string;
  cells: Record<CellRef, BundleCell>;
  labels: BundleLabels;
  facts: Facts;
}

/** Evidence for a finding whose required evidence does not fit a Bundle. Never sent to a model. */
export interface TemplateEvidence {
  findingId: string;
  templateOnly: true;
  cells: { flagged: CellRef };
  facts: Facts;
}

export type Evidence = Bundle | TemplateEvidence;

export function isBundle(e: Evidence): e is Bundle {
  return !('templateOnly' in e);
}

/** Canonical CellRefs an explanation may cite from this evidence. */
export function evidenceKeys(e: Evidence): CellRef[] {
  return isBundle(e) ? Object.keys(e.cells) : [e.cells.flagged];
}

export type Axis = 'row' | 'column';

/** What the rule's template needs: the cells it cites and the axis neighbours come from. */
export interface EvidencePlan {
  axis: Axis;
  /** Canonical CellRefs the template will cite (the flagged cell need not be listed). */
  required: readonly CellRef[];
}

const SHA_PLACEHOLDER = '0'.repeat(64);

type UnsignedBundle = Omit<Bundle, 'sha256'>;

/** Hash of a bundle's canonical JSON without its `sha256` field. */
export function bundleHash(bundle: UnsignedBundle | Bundle): string {
  const { findingId, cells, labels, facts } = bundle;
  return sha256Hex(canonicalJson({ findingId, cells, labels, facts }));
}

/** UTF-8 size of the bundle as sent (a sha256 is always 64 hex characters). */
export function bundleByteLength(bundle: UnsignedBundle | Bundle): number {
  const { findingId, cells, labels, facts } = bundle;
  return utf8ByteLength(canonicalJson({ findingId, sha256: SHA_PLACEHOLDER, cells, labels, facts }));
}

/** True when `sha256` matches the content (the edge function re-checks this, §8). */
export function verifyBundleHash(bundle: Bundle): boolean {
  return bundle.sha256 === bundleHash(bundle);
}

export function bundleCell(cell: Cell | undefined): BundleCell {
  if (!cell) return { t: 'none', v: null };
  const out: BundleCell = { t: cell.cachedType, v: sanitizeValue(cell.cachedValue) };
  if (cell.formula !== undefined) out.f = sanitizeText(`=${cell.formula}`);
  if (cell.numFmtCode !== undefined && cell.numFmtCode !== 'General') out.fmt = sanitizeText(cell.numFmtCode);
  return out;
}

function textOfCell(cell: Cell | undefined): string | null {
  if (!cell) return null;
  if (cell.cachedType !== 's' && cell.cachedType !== 'str' && cell.cachedType !== 'inlineStr') return null;
  if (typeof cell.cachedValue !== 'string') return null;
  const t = sanitizeText(cell.cachedValue).trim();
  return t.length > 0 ? t : null;
}

export function labelsFor(sheet: Sheet, row: number, col: number): BundleLabels {
  const labels: BundleLabels = {};
  for (let r = row - 1; r >= 1 && r >= row - LABEL_SCAN_LIMIT; r--) {
    const t = textOfCell(cellAt(sheet, r, col));
    if (t !== null) {
      labels.col = t;
      break;
    }
  }
  for (let c = col - 1; c >= 1 && c >= col - LABEL_SCAN_LIMIT; c--) {
    const t = textOfCell(cellAt(sheet, row, c));
    if (t !== null) {
      labels.row = t;
      break;
    }
  }
  return labels;
}

export function sanitizeFacts(facts: Facts): Facts {
  const out: Facts = {};
  for (const [k, v] of Object.entries(facts)) out[sanitizeText(k)] = sanitizeValue(v);
  return out;
}

function resolveRef(model: WorkbookModel, ref: CellRef): { key: CellRef; cell: Cell | undefined } | null {
  const p = splitCellRef(ref);
  if (!p) return null;
  const sheet = findSheet(model, p.sheet);
  if (!sheet) return { key: toCellRef(p.sheet, p.row, p.col), cell: undefined };
  return { key: toCellRef(sheet.name, p.row, p.col), cell: cellAt(sheet, p.row, p.col) };
}

/** Build the Bundle (or TemplateEvidence) for one finding. Pure; never mutates the model. */
export function buildEvidence(model: WorkbookModel, finding: Finding, plan: EvidencePlan): Evidence {
  const sheet = model.sheets.find((s) => s.name === finding.sheet) ?? findSheet(model, finding.sheet);
  const at = parseA1(finding.cell);
  const facts = sanitizeFacts(finding.facts);
  const flaggedKey = toCellRef(sheet?.name ?? finding.sheet, at?.row ?? 1, at?.col ?? 1);
  const templateOnly = (): TemplateEvidence => ({ findingId: finding.id, templateOnly: true, cells: { flagged: flaggedKey }, facts });
  if (!sheet || !at) return templateOnly();

  const cells: Record<CellRef, BundleCell> = {};
  cells[flaggedKey] = bundleCell(cellAt(sheet, at.row, at.col));
  for (const ref of plan.required) {
    const r = resolveRef(model, ref);
    if (!r) continue;
    if (!(r.key in cells)) cells[r.key] = bundleCell(r.cell);
  }
  const draft: UnsignedBundle = { findingId: finding.id, cells, labels: labelsFor(sheet, at.row, at.col), facts };
  if (bundleByteLength(draft) > BUNDLE_MAX_BYTES) return templateOnly();

  // Optional neighbours: nearest first, alternating sides, at most 4 positions per side.
  const steps: readonly [number, number][] = plan.axis === 'column' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
  const open = [true, true];
  for (let d = 1; d <= MAX_NEIGHBOURS_PER_SIDE; d++) {
    for (let side = 0; side < steps.length; side++) {
      if (!open[side]) continue;
      const row = at.row + steps[side][0] * d;
      const col = at.col + steps[side][1] * d;
      if (!isValidRow(row) || !isValidCol(col)) {
        open[side] = false;
        continue;
      }
      const key = toCellRef(sheet.name, row, col);
      if (key in cells) continue;
      const cell = cellAt(sheet, row, col);
      if (!cell) continue; // empty position: nothing to send, nothing spent
      cells[key] = bundleCell(cell);
      if (bundleByteLength(draft) > BUNDLE_MAX_BYTES) {
        delete cells[key];
        open[side] = false;
      }
    }
  }
  return { ...draft, sha256: bundleHash(draft) };
}

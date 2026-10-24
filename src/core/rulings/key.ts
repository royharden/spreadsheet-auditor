// Identity keys shared by findings, rulings and replay (PLAN §4, §8).
// - formulaHash: `v1:` + sha256 of the expanded A1 formula text (as stored, no `=`), or of
//   `type:value` for a constant. Replay compares it: equal -> a carried ruling applies,
//   different -> "stale: formula changed".
// - target keys: "latest event per (lineage, ruleId, sheet, cell) wins".

import type { Cell } from '../sheetmodel/types.ts';
import { canonicalJson } from '../util/canonicalJson.ts';
import { sha256Hex } from '../util/sha256.ts';

export const FORMULA_HASH_VERSION = 'v1';

/** The parts of a cell that define what a ruling was about. */
export type HashableCell = Pick<Cell, 'formula' | 'formulaKind' | 'cachedType' | 'cachedValue'>;

/**
 * `v1:` + sha256 hex of the formula text, or of `type:value` for constants. A formula cell
 * without text (data table, unresolved shared child) hashes `<formulaKind>:<type>:<value>`, so it
 * can never collide with a constant of the same value.
 */
export function formulaHashOf(cell: HashableCell): string {
  let material: string;
  if (cell.formula !== undefined) {
    material = cell.formula;
  } else if (cell.formulaKind !== undefined) {
    material = `${cell.formulaKind}:${cell.cachedType}:${String(cell.cachedValue)}`;
  } else {
    material = `${cell.cachedType}:${String(cell.cachedValue)}`;
  }
  return `${FORMULA_HASH_VERSION}:${sha256Hex(material)}`;
}

export interface RulingTarget {
  ruleId: string;
  sheet: string;
  cell: string;
}

/** Unambiguous key for (ruleId, sheet, cell): canonical JSON of the tuple (sheet names may hold `|`). */
export function rulingTargetKey(t: RulingTarget): string {
  return canonicalJson([t.ruleId, t.sheet, t.cell]);
}

/** Key for "latest event per (lineage, ruleId, sheet, cell)". */
export function lineageTargetKey(t: RulingTarget & { lineageId: string }): string {
  return canonicalJson([t.lineageId, t.ruleId, t.sheet, t.cell]);
}

// Finding construction and ordering shared by every rule. Rules call `newFinding`, so id,
// tier, severity and formulaHash are computed one way only.

import { formulaHashOf, type HashableCell } from '../rulings/key.ts';
import { parseA1 } from '../util/addr.ts';
import { sha256Hex } from '../util/sha256.ts';
import { RULE_META, SEVERITY_ORDER, TIER_ORDER, type Facts, type Finding, type Fix, type RuleId } from './types.ts';

/** sha256hex(`ruleId|sheet|cell`).slice(0, 12) (PLAN §4). */
export function findingId(ruleId: RuleId, sheet: string, cell: string): string {
  return sha256Hex(`${ruleId}|${sheet}|${cell}`).slice(0, 12);
}

export interface FindingInput {
  ruleId: RuleId;
  sheet: string;
  /** The flagged cell (its A1 address and the parts that define formulaHash). */
  cell: HashableCell & { addr: string };
  message: string;
  facts: Facts;
  fix: Fix;
  displayGroup?: string;
}

/** A finding with the registry's constant tier/severity; model eligibility is decided later (evidence). */
export function newFinding(input: FindingInput): Finding {
  const meta = RULE_META[input.ruleId];
  const finding: Finding = {
    id: findingId(input.ruleId, input.sheet, input.cell.addr),
    ruleId: input.ruleId,
    tier: meta.tier,
    severity: meta.severity,
    sheet: input.sheet,
    cell: input.cell.addr,
    formulaHash: formulaHashOf(input.cell),
    message: input.message,
    facts: input.facts,
    fix: input.fix,
    modelEligible: true,
  };
  if (input.displayGroup !== undefined) finding.displayGroup = input.displayGroup;
  return finding;
}

/** Sheet name -> position in the workbook. */
export type SheetOrder = ReadonlyMap<string, number>;

function position(f: Finding): { row: number; col: number } {
  const p = parseA1(f.cell);
  return p ? { row: p.row, col: p.col } : { row: Number.MAX_SAFE_INTEGER, col: Number.MAX_SAFE_INTEGER };
}

/**
 * Deterministic order: tier, severity, sheet position, row, column, rule id (the order triage
 * selection also uses, PLAN §7).
 */
export function compareFindings(a: Finding, b: Finding, sheetOrder: SheetOrder): number {
  const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  if (tier !== 0) return tier;
  const sev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  if (sev !== 0) return sev;
  const sheet = (sheetOrder.get(a.sheet) ?? Number.MAX_SAFE_INTEGER) - (sheetOrder.get(b.sheet) ?? Number.MAX_SAFE_INTEGER);
  if (sheet !== 0) return sheet;
  const pa = position(a);
  const pb = position(b);
  if (pa.row !== pb.row) return pa.row - pb.row;
  if (pa.col !== pb.col) return pa.col - pb.col;
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

/** Sorted copy (never mutates the input). */
export function sortFindings<T extends Finding>(findings: readonly T[], sheetOrder: SheetOrder): T[] {
  return [...findings].sort((a, b) => compareFindings(a, b, sheetOrder));
}

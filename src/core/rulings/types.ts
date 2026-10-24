// Human rulings and workbook versions (PLAN §4, §8). Notes never leave the device
// (`noteLocalOnly`, §2 #1); everything else here is identity, decision and time.

import { isRuleId, type RuleId } from '../rules/types.ts';
import { parseA1 } from '../util/addr.ts';

export type Decision = 'confirm' | 'dismiss' | 'by_design';

export const DECISIONS: readonly Decision[] = ['confirm', 'dismiss', 'by_design'];

export interface Ruling {
  /** UUID; appending the same eventId twice is a no-op. */
  eventId: string;
  /** UUID of the version lineage the ruled workbook belongs to. */
  lineageId: string;
  /** Lower-case hex SHA-256 of the workbook bytes. */
  workbookSha256: string;
  ruleId: RuleId;
  /** Sheet name in the workbook's own spelling. */
  sheet: string;
  /** A1 address without anchors. */
  cell: string;
  /** Finding.formulaHash at ruling time (replay compares it to mark carried rulings stale). */
  formulaHash: string;
  decision: Decision;
  /** Free text; local only, never synced (§2 #1). */
  note?: string;
  noteLocalOnly: boolean;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface WorkbookVersion {
  sha256: string;
  /** User-visible file name (may be blank). */
  displayName: string;
  lineageId: string;
  /** The version this one was explicitly linked from ("this is a new version of ..."). */
  linkedFromSha256?: string;
  createdAt: string;
}

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const A1_CELL_RE = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DISPLAY_NAME = 255;

/**
 * Validate a ruling's shape (mirrors the database checks of migration 1, §8). Returns the list
 * of problems; empty means valid.
 */
export function rulingProblems(r: Ruling): string[] {
  const problems: string[] = [];
  if (!UUID_RE.test(r.eventId)) problems.push('eventId is not a UUID');
  if (!UUID_RE.test(r.lineageId)) problems.push('lineageId is not a UUID');
  if (!SHA256_HEX_RE.test(r.workbookSha256)) problems.push('workbookSha256 is not lower-case hex SHA-256');
  if (!isRuleId(r.ruleId)) problems.push('ruleId is not one of the six rules');
  if (typeof r.sheet !== 'string' || r.sheet.length === 0) problems.push('sheet is empty');
  if (!A1_CELL_RE.test(r.cell) || !parseA1(r.cell)) problems.push('cell is not an A1 address');
  if (typeof r.formulaHash !== 'string' || !/^v1:[0-9a-f]{64}$/.test(r.formulaHash)) problems.push('formulaHash is not a v1 SHA-256');
  if (!DECISIONS.includes(r.decision)) problems.push('decision is not confirm/dismiss/by_design');
  if (r.note !== undefined && typeof r.note !== 'string') problems.push('note is not text');
  if (typeof r.noteLocalOnly !== 'boolean') problems.push('noteLocalOnly is not boolean');
  if (Number.isNaN(Date.parse(r.createdAt))) problems.push('createdAt is not a timestamp');
  return problems;
}

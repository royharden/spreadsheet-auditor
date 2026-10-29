import type { Finding } from '../rules/types.ts';
import { rulingTargetKey } from './key.ts';
import { rulingProblems, type Decision, type Ruling, type WorkbookVersion } from './types.ts';

export interface ReplayedRuling {
  eventId: string;
  decision: Decision;
  note?: string;
  noteLocalOnly: true;
  hasNote?: boolean;
  createdAt: string;
  /** History is shown, but a stale decision must not be applied to the changed finding. */
  stale: boolean;
  carriedFrom?: { workbookSha256: string };
}
export interface ReplayInput {
  workbookSha256: string;
  findings: readonly Pick<Finding, 'id' | 'ruleId' | 'sheet' | 'cell' | 'formulaHash'>[];
  rulings: readonly Ruling[];
  version?: WorkbookVersion;
}

/** Exact-file replay needs no link. Any cross-file carry requires a persisted explicit link. */
export function replayRulings(input: ReplayInput): Record<string, ReplayedRuling> {
  if (input.version && input.version.sha256 !== input.workbookSha256) throw new Error('Replay version does not match the current workbook.');
  const canCarry = input.version?.linkedFromSha256 !== undefined;
  const events = new Map<string, Ruling>();
  for (const ruling of input.rulings) {
    if (rulingProblems(ruling).length) throw new Error('Invalid ruling in replay.');
    if (!events.has(ruling.eventId)) events.set(ruling.eventId, ruling); // first event write wins
  }
  const latest = new Map<string, Ruling>();
  for (const ruling of events.values()) {
    if (input.version && ruling.lineageId !== input.version.lineageId) continue;
    if (ruling.workbookSha256 !== input.workbookSha256 && !canCarry) continue;
    const key = rulingTargetKey(ruling);
    const previous = latest.get(key);
    const time = Date.parse(ruling.createdAt);
    const previousTime = previous ? Date.parse(previous.createdAt) : -Infinity;
    if (!previous || time > previousTime || (time === previousTime && ruling.eventId > previous.eventId)) latest.set(key, ruling);
  }
  const result: Record<string, ReplayedRuling> = {};
  for (const finding of input.findings) {
    const ruling = latest.get(rulingTargetKey(finding));
    if (!ruling) continue;
    result[finding.id] = {
      eventId: ruling.eventId, decision: ruling.decision, createdAt: ruling.createdAt,
      noteLocalOnly: true, stale: ruling.formulaHash !== finding.formulaHash,
      ...(ruling.note === undefined ? {} : { note: ruling.note }),
      ...(ruling.hasNote === undefined ? {} : { hasNote: ruling.hasNote }),
      ...(ruling.workbookSha256 === input.workbookSha256 ? {} : { carriedFrom: { workbookSha256: ruling.workbookSha256 } }),
    };
  }
  return result;
}

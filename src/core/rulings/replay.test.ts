import { describe, expect, it } from 'vitest';
import { sampleRuling, SHA_A, SHA_B } from '../../storage/contract.test-helpers.ts';
import { replayRulings } from './replay.ts';
import type { WorkbookVersion } from './types.ts';

const lineage = '11111111-1111-4111-8111-111111111111';
const formulaHash = `v1:${'0'.repeat(64)}`;
const finding = { id: 'finding', ruleId: 'ERROR_VALUE' as const, sheet: 'Budget', cell: 'B5', formulaHash };
const version: WorkbookVersion = { sha256: SHA_B, lineageId: lineage, displayName: 'v2.xlsx', linkedFromSha256: SHA_A, createdAt: '2026-10-24T12:00:00.000Z' };

describe('exact replay and explicit version carry', () => {
  it('automatically replays only exact workbook bytes before an explicit link', () => {
    const ruling = sampleRuling(SHA_A, lineage, { decision: 'dismiss' });
    expect(replayRulings({ workbookSha256: SHA_A, findings: [finding], rulings: [ruling] }).finding).toMatchObject({ decision: 'dismiss', stale: false });
    expect(replayRulings({ workbookSha256: SHA_B, findings: [finding], rulings: [ruling] })).toEqual({});
    expect(replayRulings({ workbookSha256: SHA_B, findings: [finding], rulings: [ruling], version: { ...version, linkedFromSha256: undefined } })).toEqual({});
  });
  it('carries same-lineage decisions only after linking and marks changed formulas stale', () => {
    const ruling = sampleRuling(SHA_A, lineage, { decision: 'by_design', note: 'Device-only rationale' });
    const carried = replayRulings({ workbookSha256: SHA_B, findings: [finding], rulings: [ruling], version }).finding;
    expect(carried).toMatchObject({ stale: false, decision: 'by_design', noteLocalOnly: true, carriedFrom: { workbookSha256: SHA_A } });
    const changed = replayRulings({ workbookSha256: SHA_B, findings: [{ ...finding, formulaHash: `v1:${'1'.repeat(64)}` }], rulings: [ruling], version }).finding;
    expect(changed.stale).toBe(true);
    expect(changed.decision).toBe('by_design'); // visible history; consumer must not apply stale
    expect(replayRulings({ workbookSha256: SHA_B, findings: [finding], rulings: [{ ...ruling, lineageId: '22222222-2222-4222-8222-222222222222' }], version })).toEqual({});
  });
  it('uses latest timestamp and a deterministic event-id tie break, independently of input ordering', () => {
    const old = sampleRuling(SHA_A, lineage, { eventId: '00000000-0000-4000-8000-000000000001', decision: 'confirm', createdAt: '2026-10-24T10:00:00.000Z' });
    const newer = sampleRuling(SHA_A, lineage, { eventId: '00000000-0000-4000-8000-000000000002', decision: 'dismiss' });
    const tie = { ...newer, eventId: '00000000-0000-4000-8000-000000000003', decision: 'by_design' as const };
    for (const rulings of [[old, newer, tie], [tie, old, newer]]) expect(replayRulings({ workbookSha256: SHA_A, findings: [finding], rulings }).finding.decision).toBe('by_design');
    expect(replayRulings({ workbookSha256: SHA_A, findings: [finding], rulings: [old, { ...old, decision: 'dismiss' }] }).finding.decision).toBe('confirm');
  });
  it('preserves a cross-device note marker without inventing text and rejects a mismatched target version', () => {
    const ruling = sampleRuling(SHA_A, lineage, { hasNote: true });
    const result = replayRulings({ workbookSha256: SHA_A, findings: [finding], rulings: [ruling] }).finding;
    expect(result.hasNote).toBe(true);
    expect(result.note).toBeUndefined();
    expect(() => replayRulings({ workbookSha256: SHA_A, findings: [finding], rulings: [], version })).toThrow('version');
  });
});

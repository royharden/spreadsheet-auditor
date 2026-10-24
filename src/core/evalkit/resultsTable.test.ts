import { describe, expect, it } from 'vitest';
import type { AuditedFinding } from '../audit.ts';
import { RULE_META, type RuleId } from '../rules/types.ts';
import type { ManifestRow } from './manifest.ts';
import { buildSystemResult, jevDisposition, jevSentence, notRunResult, renderFailures, renderResults, summarizeLedger, type CompleteResult, type EvaluationReport, type Observation } from './resultsTable.ts';

function finding(ruleId: RuleId, cell: string): AuditedFinding {
  const id = `${ruleId}-${cell}`;
  return { id, ruleId, tier: RULE_META[ruleId].tier, severity: RULE_META[ruleId].severity, sheet: 'S', cell, formulaHash: 'test-fixture', message: 'Test', facts: {}, fix: { kind: 'text', value: 'Inspect' }, modelEligible: false,
    evidence: { templateOnly: true, findingId: id, cells: { flagged: `'S'!${cell}` }, facts: {} },
    explanation: { explanation: `${cell} needs review.`, cited_cells: [`'S'!${cell}`], source: 'template', checker: { ok: true, failures: [] }, unavailable: false } };
}
function row(workbook: string, cell: string, rule: RuleId, truth: 'defect' | 'by_design'): ManifestRow {
  return { workbook, sheet: 'S', cell, primaryRule: rule, truth, role: truth === 'defect' ? 'primary' : 'by_design', denominatorEligible: truth === 'defect', also_ok_rules: [] };
}
function complete(value: ReturnType<typeof buildSystemResult>): CompleteResult { if (value.status !== 'complete') throw new Error('Expected completed fixture.'); return value; }

describe('complete report accounting and honest unavailable systems', () => {
  it('retains raw versus surfaced metrics, named set-aside defects, benign counts and paired deltas', () => {
    const manifest = [row('clean.xlsx', 'A1', 'MIXED_UNITS', 'defect'), row('clean.xlsx', 'A2', 'CONSTANT_PLUG', 'by_design'), row('injected.xlsx', 'A1', 'MIXED_UNITS', 'defect'), row('injected.xlsx', 'A2', 'CONSTANT_PLUG', 'by_design')];
    const cleanFindings = [finding('MIXED_UNITS', 'A1'), finding('CONSTANT_PLUG', 'A2')];
    cleanFindings[0].explanation.modelFailures = [{ code: 'cited-outside-bundle', detail: 'raw model failure' }];
    const observations: Observation[] = [
      { workbook: 'clean.xlsx', findings: cleanFindings, setAsideIds: [cleanFindings[1].id], ledger: [{ latencyMs: 10, costUsd: null, status: 'live' }] },
      { workbook: 'injected.xlsx', findings: [finding('MIXED_UNITS', 'A1'), finding('CONSTANT_PLUG', 'A2')], setAsideIds: [finding('MIXED_UNITS', 'A1').id, finding('CONSTANT_PLUG', 'A2').id], ledger: [{ latencyMs: 30, costUsd: null, status: 'live' }] },
    ];
    const result = complete(buildSystemResult('2', 'live', manifest, observations, [{ workbook: 'clean.xlsx', pairId: 'pair', variant: 'clean' }, { workbook: 'injected.xlsx', pairId: 'pair', variant: 'injected' }]));
    expect(result.raw.micro).toMatchObject({ tp: 2, fp: 2, fn: 0 });
    expect(result.surfaced.micro).toMatchObject({ tp: 1, fp: 0, fn: 1 });
    expect(result.setAsideDefects).toEqual([expect.objectContaining({ workbook: 'injected.xlsx', cell: 'A1', ruleId: 'MIXED_UNITS' })]);
    expect(result).toMatchObject({ setAsideBenign: 2, setAsideCommonReviewDefects: 1, rawCitationFailures: 1, rawCitationFailedFindings: 1, postFallbackUnresolvedCitations: 0, citationInvariantPassed: true, plantedExplanationCoverage: { eligible: 2, explained: 2, proportion: 1 }, latencyMs: { p50: 20, max: 30, samples: 2 }, cost: { kind: 'unknown' } });
    expect(result.injectionDeltas[0]).toMatchObject({ defectDelta: 1, benignDelta: 0 });
    expect(result.failures.filter((failure) => failure.kind === 'FN')).toHaveLength(1);
  });

  it('marks unresolved explanations, refuses Confirmed set-aside, and rejects synthetic evidence for model systems', () => {
    const confirmed = finding('ERROR_VALUE', 'A1');
    expect(() => buildSystemResult('2', 'live', [], [{ workbook: 'book.xlsx', findings: [confirmed], setAsideIds: [confirmed.id], ledger: [] }], [])).toThrow('Confirmed');
    const review = finding('MIXED_UNITS', 'A1');
    review.explanation.checker.ok = false;
    review.explanation.unavailable = true;
    review.explanation.explanation = null;
    const result = complete(buildSystemResult('1', 'template', [row('book.xlsx', 'A1', 'MIXED_UNITS', 'defect')], [{ workbook: 'book.xlsx', findings: [review], setAsideIds: [], ledger: [] }], []));
    expect(result).toMatchObject({ postFallbackUnresolvedCitations: 1, citationInvariantPassed: false, plantedExplanationCoverage: { explained: 0 }, cost: { kind: 'unknown' }, latencyMs: { p50: null, max: null } });
    expect(buildSystemResult('3', 'synthetic-test', [], [], [])).toMatchObject({ status: 'not-run' });
  });

  it('labels empty pricing unknown and mock measurements replay; sums only known real prices', () => {
    expect(summarizeLedger([]).cost).toEqual({ kind: 'unknown' });
    expect(summarizeLedger([{ latencyMs: 1, costUsd: null, status: 'replay' }]).cost).toEqual({ kind: 'replay' });
    expect(summarizeLedger([{ latencyMs: 1, costUsd: 0.02, status: 'live' }, { latencyMs: 3, costUsd: 0.03, status: 'live' }]).cost).toEqual({ kind: 'usd', value: 0.05 });
  });

  it('keeps a not-run result structurally distinct and writes every named failure to Markdown', () => {
    const system = complete(buildSystemResult('1', 'template', [row('book.xlsx', 'A1', 'FORMULA_DRIFT', 'defect')], [{ workbook: 'book.xlsx', findings: [finding('MIXED_UNITS', 'B9')], setAsideIds: [], ledger: [] }], []));
    const unavailable = notRunResult('3', 'No real provider evidence.');
    expect(unavailable).toMatchObject({ status: 'not-run', raw: null, surfaced: null, rawCitationFailures: null, postFallbackUnresolvedCitations: null, setAsideDefects: null, injectionDeltas: null, plantedExplanationCoverage: null, latencyMs: null, cost: null, failures: null });
    const report: EvaluationReport = { schemaVersion: 1, generatedAt: 'fixture-time', split: 'test', pins: {}, systems: [system, unavailable], jevOutcome: 'not-evaluated', jevSentence: jevSentence('not-evaluated') };
    const table = renderResults(report);
    for (const label of ['Wilson 95%', 'macro', 'Raw citation failures', 'unresolved after fallback', 'Set-aside defects', 'Planted explanation coverage', 'Latency from ledger', 'Cost: unknown', 'Injection pair', 'Not run:']) expect(table).toContain(label);
    const failures = renderFailures(report);
    expect(failures).toContain('B9');
    expect(failures).toContain('A1');
    expect(failures).toContain('FORMULA_DRIFT');
    expect(failures).toContain('not run');
    expect(jevDisposition(report.systems, 0)).toBe('not-evaluated');
  });
});

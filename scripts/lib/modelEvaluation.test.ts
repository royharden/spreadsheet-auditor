import { describe, expect, it, vi } from 'vitest';
import { buildBudgetQ3 } from '../../generator/samples.ts';
import { runAudit } from '../../src/core/audit.ts';
import { CallLedger } from '../../src/core/callledger/ledger.ts';
import { selectTriage } from '../../src/core/triage/select.ts';
import { evaluateModelAudit, evaluationProvider, modelUnavailable, type ModelSettings } from './modelEvaluation.ts';

const settings: ModelSettings = { mode: 'live', generativeModel: 'fixture', jevModel: 'jev-fixture', budgetUsd: 10, anthropicKey: 'test-only', typesafeKey: 'test-only' };
describe('model evaluation provenance and spending gates', () => {
  it('denies unpriced live calls before transport and refuses synthetic measurement provenance', async () => {
    const audit = runAudit(buildBudgetQ3(1));
    const transport = vi.fn();
    expect(modelUnavailable(settings, '2', { version: 1, entries: [] })).toContain('prices');
    expect(() => evaluationProvider(settings, '2', { version: 1, entries: [] }, audit, 'fixture', new CallLedger(10), transport)).toThrow('prices');
    expect(transport).not.toHaveBeenCalled();
    await expect(evaluateModelAudit(audit, 'sample.xlsx', '2', 'fixture', 'fixture', { origin: 'synthetic-test', triage: vi.fn(async () => []) })).rejects.toThrow('Synthetic');
  });
  it('feeds checked Jev templates and raw findings to the system result seam', async () => {
    const audit = runAudit(buildBudgetQ3(1));
    const selection = selectTriage(audit, 'jev');
    const provider = { origin: 'recorded-live' as const, triage: vi.fn(async () => selection.bundles.map((bundle) => ({ findingId: bundle.findingId, bundleSha256: bundle.sha256,
      triage: 'by_design' as const, explanation: 'Transport placeholder.', cited_cells: [] }))) };
    const result = await evaluateModelAudit(audit, 'sample.xlsx', '3', 'fixture', 'fixture', provider);
    expect(result.observation.findings).toHaveLength(audit.findings.length);
    expect(result.observation.setAsideIds).toEqual(selection.findings.map((finding) => finding.id));
    expect(result.observation.findings.filter((f) => f.tier === 'confirmed')).toEqual(audit.findings.filter((f) => f.tier === 'confirmed'));
    expect(result.observation.ledger[0].status).toBe('replay');
  });
  it('keeps no-call observations distinct from replay and from fabricated timing', async () => {
    const audit = runAudit(buildBudgetQ3(1));
    const empty = { ...audit, findings: audit.findings.filter((finding) => finding.tier === 'confirmed') };
    const provider = { origin: 'live' as const, triage: vi.fn(async () => []) };
    const result = await evaluateModelAudit(empty, 'sample.xlsx', '2', 'fixture', 'fixture', provider);
    expect(provider.triage).not.toHaveBeenCalled();
    expect(result.observation.ledger).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { buildBudgetQ3, budgetQ3Source } from '../../../generator/samples.ts';
import { injectionTwin } from '../../../generator/injection.ts';
import { writeXlsx } from '../../../generator/xlsxWriter.ts';
import { buildSyntheticDemoCache, SYNTHETIC_LABEL, SYNTHETIC_MODEL } from '../../app/demo/syntheticCache.ts';
import { runAudit } from '../audit.ts';
import { errorsWorkbook } from '../testFixtures.ts';
import { driftColumnWorkbook } from '../rules/m3Fixtures.ts';
import { triageAudit } from '../triage/run.ts';
import { selectTriage } from '../triage/select.ts';
import { cacheContext, cacheKey, parseCache } from './cache.ts';
import { createMockProvider, MockCacheMiss } from './mock.ts';

describe('mock provenance and scope', () => {
  it('replays sample keys with explicit synthetic labels, a bad citation fallback and tax-rate set aside', async () => {
    const audit = runAudit(buildBudgetQ3(1));
    const cache = parseCache({ version: 1, entries: buildSyntheticDemoCache(audit) });
    expect(SYNTHETIC_LABEL).toContain('synthetic');
    expect(cache.entries.every((entry) => entry.origin === 'synthetic-test')).toBe(true);
    const result = await triageAudit(audit, { provider: createMockProvider(cache), model: SYNTHETIC_MODEL, requestId: 'fixture', arm: 'generative' });
    const tax = audit.findings.find((f) => f.ruleId === 'CONSTANT_PLUG' && f.cell === 'G16')!;
    expect(result.setAsideIds).toContain(tax.id);
    expect(result.findings.some((f) => (f.explanation.modelFailures?.length ?? 0) > 0)).toBe(true);
    expect(result.findings.every((f) => f.explanation.checker.ok)).toBe(true);
  });
  it('throws a loud miss for arbitrary non-sample workbooks and never synthesises their responses', async () => {
    const audit = runAudit(errorsWorkbook());
    expect(buildSyntheticDemoCache(audit)).toEqual([]);
    const sample = runAudit(buildBudgetQ3(1));
    await expect(triageAudit(sample, { provider: createMockProvider({ version: 1, entries: [] }), model: SYNTHETIC_MODEL, requestId: 'fixture', arm: 'generative' })).rejects.toBeInstanceOf(MockCacheMiss);
    const nonSample = runAudit(driftColumnWorkbook());
    expect(buildSyntheticDemoCache(nonSample)).toEqual([]);
    await expect(triageAudit(nonSample, { provider: createMockProvider({ version: 1, entries: buildSyntheticDemoCache(sample) }), model: SYNTHETIC_MODEL, requestId: 'fixture', arm: 'generative' })).rejects.toBeInstanceOf(MockCacheMiss);
  });
  it('keys include prompt/schema/arm/model and an altered response binding misses', async () => {
    const audit = runAudit(buildBudgetQ3(1));
    const bundle = selectTriage(audit, 'generative').bundles[0];
    const context = cacheContext('generative', SYNTHETIC_MODEL);
    expect(cacheKey(bundle, context)).not.toBe(cacheKey(bundle, { ...context, promptVersion: 'changed' }));
    expect(cacheKey(bundle, context)).not.toBe(cacheKey(bundle, { ...context, model: 'different' }));
    const entries = buildSyntheticDemoCache(audit);
    entries[0].response.bundleSha256 = '0'.repeat(64);
    await expect(createMockProvider({ version: 1, entries }).triage({ requestId: 'fixture', arm: 'generative', model: SYNTHETIC_MODEL, bundles: [bundle] })).rejects.toBeInstanceOf(MockCacheMiss);
  });
  it('template mode makes no network call', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('network forbidden'); });
    try { expect((await triageAudit(runAudit(buildBudgetQ3(1)))).setAsideIds).toEqual([]); }
    finally { vi.unstubAllGlobals(); }
  });
  it('Confirmed findings survive injected workbook instructions under a mock provider', async () => {
    const normalized: unknown[][] = [];
    for (const variant of ['clean', 'injected'] as const) {
      const audit = runAudit(writeXlsx(injectionTwin(budgetQ3Source(1), variant)));
      const before = audit.findings.filter((finding) => finding.tier === 'confirmed');
      const provider = { origin: 'recorded-live' as const, triage: vi.fn(async () => []) };
      const result = await triageAudit(audit, { provider, model: 'fixture-model', requestId: 'fixture', arm: 'generative' });
      expect(result.findings.filter((finding) => finding.tier === 'confirmed')).toEqual(before);
      normalized.push(result.findings.filter((finding) => finding.tier === 'confirmed').map((finding) => ({ ruleId: finding.ruleId, cell: finding.cell, formulaHash: finding.formulaHash, tier: finding.tier, fix: finding.fix })));
    }
    expect(normalized[1]).toEqual(normalized[0]);
  });
});

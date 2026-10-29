import { describe, expect, it, vi } from 'vitest';
import { M2_FIXTURES, longTextWorkbook } from './testFixtures.ts';
import { isBundle } from './evidence/bundle.ts';
import { runAudit, runAuditSafe } from './audit.ts';

describe('audit pipeline', () => {
  it('returns plain JSON with summary, coverage, findings and verified templates for every fixture', () => {
    for (const fixture of M2_FIXTURES) {
      const audit = runAudit(fixture.build(), { fileName: fixture.fileName });
      expect(JSON.parse(JSON.stringify(audit))).toEqual(audit);
      expect(audit.summary.capsOk).toBe(true);
      expect(audit.summary.findings).toBe(audit.findings.length);
      expect(audit.summary.rulesRun).toBe(6);
      expect(audit.coverage.skippedRules).toHaveLength(0);
      expect(audit.findings.every((f) => f.explanation.checker.ok)).toBe(true);
    }
  });
  it('disables model eligibility only when required evidence cannot fit', () => {
    const audit = runAudit(longTextWorkbook());
    expect(audit.summary.templateOnly).toBeGreaterThan(0);
    for (const f of audit.findings) {
      if (isBundle(f.evidence)) expect(f.ineligibleReason).toBeUndefined();
      else expect(f).toMatchObject({ modelEligible: false, ineligibleReason: 'evidence-too-large' });
    }
  });
  it('keeps template mode entirely offline', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network forbidden'); });
    try { expect(runAudit(M2_FIXTURES[0].build()).findings.length).toBeGreaterThan(0); }
    finally { vi.unstubAllGlobals(); }
  });
  it('returns a typed gate refusal rather than a partial audit', () => {
    expect(runAuditSafe(new Uint8Array(4), { fileName: 'old.xls' })).toMatchObject({ ok: false, refusal: { code: 'unsupported-extension' } });
  });
});

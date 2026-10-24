import { describe, expect, it, vi } from 'vitest';
import { runAudit } from '../audit.ts';
import { M2_FIXTURES, errorsWorkbook } from '../testFixtures.ts';
import { checkExplanation } from '../cited/checker.ts';
import { explainFinding, templateFor } from './templates.ts';

describe('template-always-passes invariant', () => {
  for (const fixture of M2_FIXTURES) {
    it(`passes every finding of ${fixture.name}, including template-only evidence`, () => {
      const audit = runAudit(fixture.build(), { fileName: fixture.fileName });
      for (const finding of audit.findings) {
        const candidate = templateFor(finding.ruleId).render(finding, finding.evidence);
        expect(checkExplanation(candidate, finding.evidence, { sheet: finding.sheet }), `${finding.ruleId} ${finding.sheet}!${finding.cell}`).toEqual({ ok: true, failures: [] });
        expect(finding.explanation.unavailable).toBe(false);
      }
    });
  }

  it('records a failed model citation and returns the checked template from the same evidence', () => {
    const finding = runAudit(errorsWorkbook()).findings[0];
    const result = explainFinding(finding, finding.evidence, { explanation: 'Z999 is incorrect.', cited_cells: ['Z999'] });
    expect(result).toMatchObject({ source: 'template', unavailable: false, checker: { ok: true } });
    expect(result.modelFailures?.some((f) => f.code === 'cited-outside-bundle')).toBe(true);
    expect(result.explanation).toBe(finding.explanation.explanation);
  });

  it.each([
    { label: 'invented exponent', claim: '1e9' },
    { label: 'overflowing exponent', claim: '1e999' },
    { label: 'overflowing decimal', claim: '9'.repeat(400) },
  ])('uses the checked template and records rejection of an $label', ({ claim }) => {
    const finding = runAudit(errorsWorkbook()).findings.find((f) => f.ruleId === 'BROKEN_REF');
    if (!finding) throw new Error('The fixture must include a BROKEN_REF finding');
    expect(finding.facts.ref_error_count).toBe(1);
    const result = explainFinding(finding, finding.evidence, {
      explanation: `${finding.cell} contains ${claim}.`, cited_cells: [finding.cell],
    });
    expect(result).toMatchObject({ source: 'template', unavailable: false, checker: { ok: true } });
    expect(result.modelFailures?.some((f) => f.code === 'ungrounded-number')).toBe(true);
    expect(result.explanation).toBe(finding.explanation.explanation);
  });

  it('returns explanation unavailable when even the template fails its checker', () => {
    const finding = runAudit(errorsWorkbook()).findings[0];
    const template = templateFor(finding.ruleId);
    const spy = vi.spyOn(template, 'render').mockReturnValue({ explanation: 'Z999 is wrong.', cited_cells: ['Z999'] });
    try {
      expect(explainFinding(finding, finding.evidence)).toMatchObject({ explanation: null, cited_cells: [], unavailable: true, checker: { ok: false } });
    } finally { spy.mockRestore(); }
  });
});

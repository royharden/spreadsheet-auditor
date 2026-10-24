import { describe, expect, it } from 'vitest';
import { buildBudgetQ3 } from '../../../generator/samples.ts';
import { runAudit, type AuditResult } from '../audit.ts';
import { bundleHash, isBundle } from '../evidence/bundle.ts';
import { sha256Hex } from '../util/sha256.ts';
import { applyTriage } from './apply.ts';
import { selectTriage } from './select.ts';
import type { TriageResult } from '../explain/triageSchema.ts';

function fixture(arm: 'generative' | 'jev' = 'generative') {
  const audit = runAudit(buildBudgetQ3(1));
  const selection = selectTriage(audit, arm);
  const responses: TriageResult[] = selection.findings.map((finding) => {
    if (!isBundle(finding.evidence)) throw new Error('Fixture bundle missing.');
    return { findingId: finding.id, bundleSha256: finding.evidence.sha256, triage: 'mistake',
      explanation: finding.explanation.explanation!, cited_cells: finding.explanation.cited_cells };
  });
  return { audit, selection, responses };
}
describe('bounded triage selection and application', () => {
  it('selects exactly 200 eligible findings in deterministic order and counts the rest', () => {
    const { audit, selection } = fixture();
    const base = selection.findings[0];
    if (!isBundle(base.evidence)) throw new Error('Missing fixture bundle.');
    const evidence = base.evidence;
    const findings = Array.from({ length: 205 }, (_, index) => {
      const id = sha256Hex(String(index)).slice(0, 12);
      const unsigned = { ...evidence, findingId: id };
      return { ...base, id, cell: `A${index + 1}`, evidence: { ...unsigned, sha256: bundleHash(unsigned) } };
    }).reverse();
    const many: AuditResult = { ...audit, findings };
    const selected = selectTriage(many, 'generative');
    expect(selected.findings).toHaveLength(200);
    expect(selected.bundles).toHaveLength(200);
    expect(selected.notTriaged).toBe(5);
    expect(selected.findings[0].cell).toBe('A1');
    expect(selected.findings[199].cell).toBe('A200');
  });
  it('keeps raw findings/Confirmed/fixes immutable while by_design affects only set-aside ids', () => {
    const { audit, selection, responses } = fixture();
    responses[0].triage = 'by_design';
    const before = JSON.stringify(audit);
    const result = applyTriage(audit, selection, responses, 'generative');
    expect(result.findings).toHaveLength(audit.findings.length);
    expect(result.setAsideIds).toEqual([responses[0].findingId]);
    for (const finding of audit.findings) {
      const after = result.findings.find((f) => f.id === finding.id)!;
      expect(after.fix).toEqual(finding.fix);
      expect(after.tier).toBe(finding.tier);
      if (finding.tier === 'confirmed') expect(after).toBe(finding);
    }
    expect(JSON.stringify(audit)).toBe(before);
  });
  it('falls back for added/Confirmed ids, duplicates, omissions, changed hashes and extra fields', () => {
    for (const problem of ['unknown', 'confirmed', 'duplicate', 'omitted', 'hash', 'tier', 'formula', 'fix'] as const) {
      const { audit, selection, responses } = fixture();
      const changed: unknown[] = responses.map((row) => ({ ...row }));
      if (problem === 'unknown') changed.push({ ...responses[0], findingId: '0'.repeat(12) });
      if (problem === 'confirmed') changed.push({ ...responses[0], findingId: audit.findings.find((f) => f.tier === 'confirmed')!.id });
      if (problem === 'duplicate') changed.push(responses[0]);
      if (problem === 'omitted') changed.shift();
      if (problem === 'hash') changed[0] = { ...responses[0], bundleSha256: '0'.repeat(64) };
      if (['tier', 'formula', 'fix'].includes(problem)) changed[0] = { ...responses[0], [problem]: 'invented' };
      const result = applyTriage(audit, selection, changed, 'generative');
      expect(result.triages.find((row) => row.findingId === responses[0].findingId)?.triage, problem).toBe('unclear');
      expect(result.issues.length, problem).toBeGreaterThan(0);
      expect(result.setAsideIds).toEqual([]);
    }
  });
  it('checks generative citations before setting aside and records raw failures', () => {
    const { audit, selection, responses } = fixture();
    responses[0] = { ...responses[0], triage: 'by_design', explanation: 'Z999 is wrong.', cited_cells: ['Z999'] };
    const result = applyTriage(audit, selection, responses, 'generative');
    const finding = result.findings.find((f) => f.id === responses[0].findingId)!;
    expect(result.setAsideIds).toEqual([]);
    expect(finding.explanation).toMatchObject({ source: 'template', checker: { ok: true } });
    expect(finding.explanation.modelFailures?.length).toBeGreaterThan(0);
  });
  it('Jev selects Review only and retains checked code templates even when transport prose differs', () => {
    const { audit, selection, responses } = fixture('jev');
    expect(selection.findings.every((finding) => finding.tier === 'review')).toBe(true);
    responses[0] = { ...responses[0], triage: 'by_design', explanation: 'Model transport placeholder.', cited_cells: [] };
    const result = applyTriage(audit, selection, responses, 'jev');
    expect(result.setAsideIds).toContain(responses[0].findingId);
    const finding = result.findings.find((f) => f.id === responses[0].findingId)!;
    expect(finding.explanation).toEqual(audit.findings.find((f) => f.id === finding.id)!.explanation);
    expect(finding.explanation.source).toBe('template');
  });
});

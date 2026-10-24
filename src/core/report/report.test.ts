import { describe, expect, it } from 'vitest';
import { buildBudgetQ3 } from '../../../generator/samples.ts';
import { runAudit } from '../audit.ts';
import type { ReplayedRuling } from '../rulings/replay.ts';
import { createReport } from './reportSchema.ts';
import { toJson } from './toJson.ts';
import { toMarkdown } from './toMarkdown.ts';

const generatedAt = '2026-10-24T12:00:00.000Z';
const sourceSha = 'a'.repeat(64);
function ruling(decision: ReplayedRuling['decision'], extra: Partial<ReplayedRuling> = {}): ReplayedRuling {
  return { eventId: '00000000-0000-4000-8000-000000000001', decision, createdAt: generatedAt, noteLocalOnly: true, stale: false, ...extra };
}

describe('complete versioned local exports', () => {
  it('retains all findings with effective human/model set-aside precedence, dismissed entries, coverage and version links', () => {
    const audit = runAudit(buildBudgetQ3(2));
    const drift = audit.findings.find((finding) => finding.ruleId === 'FORMULA_DRIFT')!;
    const plug = audit.findings.find((finding) => finding.ruleId === 'CONSTANT_PLUG')!;
    const units = audit.findings.find((finding) => finding.ruleId === 'MIXED_UNITS')!;
    audit.coverage.skippedRules.push({ ruleId: 'FORMULA_DRIFT', reason: 'fixture skip disclosure' });
    const report = createReport({ audit, triaged: { findings: audit.findings, setAsideIds: [plug.id, units.id], triages: [], notTriaged: 3, issues: [] },
      rulings: { [drift.id]: ruling('by_design', { hasNote: true, carriedFrom: { workbookSha256: sourceSha } }), [plug.id]: ruling('dismiss', { note: 'Local note <script>private</script>' }), [units.id]: ruling('confirm', { stale: true }) },
      version: { sha256: audit.workbook.sha256, displayName: 'v2.xlsx', lineageId: '11111111-1111-4111-8111-111111111111', linkedFromSha256: sourceSha, createdAt: generatedAt },
      versions: [{ sha256: sourceSha, displayName: 'v1.xlsx', lineageId: '11111111-1111-4111-8111-111111111111', createdAt: generatedAt }], mode: 'mock', generatedAt });
    expect(report.findings.length + report.setAside.length).toBe(audit.findings.length);
    expect(report.findings.find((finding) => finding.id === plug.id)?.ruling?.decision).toBe('dismiss');
    expect(report.setAside.map((finding) => finding.id)).toEqual(expect.arrayContaining([drift.id, units.id]));
    expect(report.workbook.linkedFrom).toEqual({ sha256: sourceSha, displayName: 'v1.xlsx' });
    expect(report.notTriaged).toBe(3);
    expect(report.coverage.skippedRules).toHaveLength(1);
    const json = JSON.parse(toJson(report)) as typeof report;
    expect(json.setAside.find((finding) => finding.id === drift.id)?.ruling?.carriedFrom?.workbookSha256).toBe(sourceSha);
    const md = toMarkdown(report);
    for (const required of ['including human-dismissed', 'originating device', 'stale: formula changed', 'fixture skip disclosure', 'not triaged: 3', 'Carried from workbook']) expect(md).toContain(required);
    expect(md).toContain('Local note &lt;script&gt;private&lt;/script&gt;');
    expect(md).not.toContain('<script>');
    audit.findings.length = 0;
    expect(report.findings.length + report.setAside.length).toBeGreaterThan(0);
  });
  it('pins the JSON v1 shape and keeps missing triaged entries instead of dropping findings', () => {
    const audit = runAudit(buildBudgetQ3(1));
    expect(createReport({ audit, mode: 'template', generatedAt }).notTriaged).toBe(audit.findings.filter((finding) => finding.tier !== 'confirmed').length);
    const report = createReport({ audit, triaged: { findings: [], setAsideIds: [], triages: [], notTriaged: 0, issues: [] }, mode: 'template', generatedAt });
    expect(report.findings).toHaveLength(audit.findings.length);
    expect({ reportVersion: report.reportVersion, keys: Object.keys(JSON.parse(toJson(report)) as object).sort() }).toMatchInlineSnapshot(`
      {
        "keys": [
          "coverage",
          "externalLinks",
          "findings",
          "generatedAt",
          "mode",
          "notTriaged",
          "reportVersion",
          "setAside",
          "workbook",
        ],
        "reportVersion": 1,
      }
    `);
  });
});

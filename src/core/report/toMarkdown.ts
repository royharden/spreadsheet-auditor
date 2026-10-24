import type { ReportFinding, ReportV1 } from './reportSchema.ts';

function text(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }
function findingLines(finding: ReportFinding, setAside: boolean): string[] {
  const ruling = finding.ruling;
  const lines = [`### ${text(finding.ruleId)}: ${text(finding.sheet)}!${text(finding.cell)}`, '', `Tier: ${finding.tier}; severity: ${finding.severity}; disposition: ${setAside ? 'set aside' : 'surfaced'}.`, '', text(finding.explanation.explanation ?? 'Explanation unavailable.'), '', `Citations verified: ${finding.explanation.checker.ok}; source: ${finding.explanation.source}.`, '', `Suggested ${finding.fix.kind} fix: ${text(finding.fix.value)}`, ''];
  if (finding.triage) lines.push(`Triage: ${finding.triage.triage}${finding.triage.reason ? ` (${text(finding.triage.reason)})` : ''}.`, '');
  if (ruling) {
    lines.push(`Human ruling: ${ruling.decision}; ${ruling.stale ? 'stale: formula changed (decision not applied)' : 'current'}; ${text(ruling.createdAt)}.`, '');
    if (ruling.carriedFrom) lines.push(`Carried from workbook SHA-256: ${ruling.carriedFrom.workbookSha256}.`, '');
    if (ruling.note !== undefined) lines.push(`Device-local note (included only in this export): ${text(ruling.note)}`, '');
    else if (ruling.hasNote) lines.push('A note exists on the originating device; its text is unavailable here.', '');
  }
  return lines;
}

export function toMarkdown(report: ReportV1): string {
  const lines = ['# Spreadsheet audit report', '', `Workbook: ${text(report.workbook.name)}`, '', `SHA-256: ${report.workbook.sha256}`, '', `Report version: ${report.reportVersion}; generated: ${text(report.generatedAt)}; mode: ${report.mode}.`, '', `Formula cells: ${report.workbook.formulaCells}; not triaged: ${report.notTriaged}.`, ''];
  if (report.workbook.linkedFrom) lines.push(`Linked from: ${text(report.workbook.linkedFrom.displayName)} (${report.workbook.linkedFrom.sha256}).`, '');
  lines.push('## Coverage and external links', '', '```json', JSON.stringify({ coverage: report.coverage, externalLinks: report.externalLinks, sheets: report.workbook.sheets }, null, 2), '```', '', '## Findings (including human-dismissed findings)', '');
  for (const finding of report.findings) lines.push(...findingLines(finding, false));
  lines.push('## Set aside (retained in the export)', '');
  for (const finding of report.setAside) lines.push(...findingLines(finding, true));
  return `${lines.join('\n')}\n`;
}

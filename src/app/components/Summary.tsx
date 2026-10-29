import type { AuditResult } from '../../core/audit.ts';

export function Summary({ audit }: { audit: AuditResult }) {
  const s = audit.summary;
  return <section aria-labelledby="summary-title">
    <h2 id="summary-title">Summary: {audit.workbook.name}</h2>
    <p>{s.sheets} sheets · {s.formulaCells} formula cells · caps OK · {s.findings} findings</p>
    <p>{s.rulesRun} rules analysed · {s.opaqueCells} opaque formula cells · {s.externalLinks} external links (not followed)</p>
    <p>{s.templateOnly} findings use local template evidence · {s.explanationsUnavailable} explanations unavailable</p>
    <h3>Skipped rules</h3>
    {audit.coverage.skippedRules.length ? <ul>{audit.coverage.skippedRules.map((rule) =>
      <li key={rule.ruleId}>{rule.ruleId}: {rule.reason}</li>)}</ul> : <p>None.</p>}
    {audit.coverage.opaque.length > 0 && <details><summary>Not analysed / opaque formulas</summary>
      <ul>{audit.coverage.opaque.map((entry, i) => <li key={i}>{entry.cell}: {entry.category}</li>)}</ul>
    </details>}
    {audit.externalLinks.length > 0 && <details><summary>External links</summary>
      <ul>{audit.externalLinks.map((link, i) => <li key={i}>{link}</li>)}</ul>
    </details>}
    {audit.coverage.notes.length > 0 && <details><summary>Coverage notes</summary>
      <ul>{audit.coverage.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
    </details>}
  </section>;
}

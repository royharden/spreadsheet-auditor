import type { AuditedFinding } from '../../core/audit.ts';
import { TIER_LABEL } from '../../core/rules/types.ts';

export function FindingsTable({ findings }: { findings: readonly AuditedFinding[] }) {
  return <section aria-labelledby="findings-title">
    <h2 id="findings-title">Findings</h2>
    {!findings.length ? <p>No findings from the rules analysed.</p> : <ol className="findings">{findings.map((finding) =>
      <li key={finding.id}>
        <h3>{finding.sheet}!{finding.cell} — {TIER_LABEL[finding.tier]} · {finding.ruleId}</h3>
        <p>{finding.message}</p>
        {finding.displayGroup && <p>Related cached-error finding: {finding.displayGroup}</p>}
        <p>{finding.explanation.explanation ?? 'Explanation unavailable'}</p>
        {finding.explanation.checker.ok && <small>Citations verified · template explanation</small>}
        <p><strong>Suggested fix:</strong> {finding.fix.value}</p>
      </li>)}</ol>}
  </section>;
}

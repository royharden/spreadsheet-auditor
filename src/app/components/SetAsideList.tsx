import type { AuditedFinding } from '../../core/audit.ts';
export function SetAsideList({ findings, onSelect }: { findings: readonly AuditedFinding[]; onSelect: (id: string) => void }) {
  return <section aria-label="Set aside"><h2>Set aside (by design)</h2>
    {findings.length ? <ul>{findings.map((finding) => <li key={finding.id}><button type="button" onClick={() => onSelect(finding.id)}>Review set-aside {finding.sheet}!{finding.cell} — {finding.ruleId}</button></li>)}</ul> : <p>No findings set aside.</p>}
  </section>;
}

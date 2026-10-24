import type { AuditedFinding } from '../../core/audit.ts';
import { TIER_LABEL } from '../../core/rules/types.ts';
import { sortFindings } from '../../core/rules/finding.ts';

export function FindingsTable({ findings, onSelect }: { findings: readonly AuditedFinding[]; onSelect: (id: string) => void }) {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const groups = new Map<string, AuditedFinding[]>();
  const roots = new Map<string, string>();
  const sheetOrder = new Map([...new Set(findings.map((finding) => finding.sheet))].map((sheet, index) => [sheet, index]));
  for (const finding of sortFindings(findings, sheetOrder)) {
    let root = finding;
    const seen = new Set<string>();
    while (root.displayGroup && byId.has(root.displayGroup) && !seen.has(root.id) && !roots.has(root.id)) {
      seen.add(root.id); root = byId.get(root.displayGroup)!;
    }
    const rootId = roots.get(root.id) ?? (seen.has(root.id) ? [...seen].sort()[0] : root.id);
    roots.set(finding.id, rootId);
    for (const id of seen) roots.set(id, rootId);
    const group = groups.get(rootId) ?? []; group.push(finding); groups.set(rootId, group);
  }
  const item = (finding: AuditedFinding) => <li key={finding.id}>
    <button type="button" onClick={() => onSelect(finding.id)}>Open {finding.sheet}!{finding.cell} — {finding.ruleId}</button>
    <p>{TIER_LABEL[finding.tier]} · {finding.severity} · {finding.message}</p>
  </li>;
  return <section aria-labelledby="findings-title">
    <h2 id="findings-title">Findings</h2>
    {!findings.length ? <p>No findings from the rules analysed.</p> : <ol className="findings">{[...groups].map(([rootId, group]) => group.length === 1 ? item(group[0]) :
      <li key={rootId}><details><summary>Cached error group at {byId.get(rootId)?.cell} ({group.length} findings)</summary><ol>{group.map(item)}</ol></details></li>)}</ol>}
  </section>;
}

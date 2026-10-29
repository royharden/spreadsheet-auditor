import type { AuditedFinding } from '../../core/audit.ts';
import type { ReplayedRuling } from '../../core/rulings/replay.ts';
import type { Decision } from '../../core/rulings/types.ts';
import { EvidenceGrid } from './EvidenceGrid.tsx';
import { RulingControls } from './RulingControls.tsx';
export function FindingDetail({ finding, ruling, disabled, onRuling }: { finding: AuditedFinding; ruling?: ReplayedRuling; disabled: boolean; onRuling: (decision: Decision, note: string) => Promise<void> }) {
  return <section aria-label="Finding detail"><h2>{finding.sheet}!{finding.cell} — {finding.ruleId}</h2>
    <p>{finding.explanation.explanation ?? 'Explanation unavailable'}</p>
    {finding.explanation.checker.ok && <p>Citations verified · {finding.explanation.source === 'template' ? 'code template' : 'model explanation'}</p>}
    {finding.explanation.modelFailures && <p>Template used: citation check failed.</p>}
    {ruling && <div className="banner"><p>{ruling.stale ? 'Stale: formula changed. Prior ruling is not applied.' : `Your ruling: ${ruling.decision}`}</p>
      {ruling.carriedFrom && <p>Carried from version {ruling.carriedFrom.workbookSha256.slice(0, 12)}</p>}
      {ruling.note && <p>Local note: {ruling.note}</p>}
      {!ruling.note && ruling.hasNote && <p>A local-only note was marked for this ruling. Its text is unavailable on this device.</p>}
    </div>}
    <h3>Outbound evidence</h3><EvidenceGrid evidence={finding.evidence} />
    <details><summary>Local finding details — not the outbound bundle</summary>
      <p>{finding.message}</p><p>Suggested fix: {finding.fix.value}</p>
      <p>Formula/value identity: {finding.formulaHash}</p><pre>{JSON.stringify(finding.facts, null, 2)}</pre>
      <p>This is the locally generated finding record. A raw workbook grid is not included in this audit response.</p>
    </details>
    <RulingControls key={finding.id} disabled={disabled} onRuling={onRuling} />
  </section>;
}

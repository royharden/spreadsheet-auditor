import type { Bundle } from '../../core/evidence/bundle.ts';
import { EvidenceGrid } from './EvidenceGrid.tsx';
export function BundlePreview({ bundles, busy, onSend, onCancel }: { bundles: readonly Bundle[]; busy: boolean; onSend: () => void; onCancel: () => void }) {
  return <section className="preview" aria-label="Outbound bundle preview"><h2>Preview evidence before Live</h2>
    <p>Only these {bundles.length} bounded bundles will be sent. Workbook files and local ruling notes are excluded.</p>
    {bundles.map((bundle) => <details key={bundle.findingId}><summary>Finding {bundle.findingId}</summary><EvidenceGrid evidence={bundle} />
      <pre>{JSON.stringify({ labels: bundle.labels, facts: bundle.facts, sha256: bundle.sha256 }, null, 2)}</pre></details>)}
    <button type="button" disabled={busy || bundles.length === 0} onClick={onSend}>Send these bundles</button>{' '}
    <button type="button" disabled={busy} onClick={onCancel}>Cancel preview</button>
  </section>;
}

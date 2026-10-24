import type { Evidence } from '../../core/evidence/bundle.ts';
import { isBundle } from '../../core/evidence/bundle.ts';
export function EvidenceGrid({ evidence }: { evidence: Evidence }) {
  if (!isBundle(evidence)) return <p>Required evidence exceeds the outbound limit. This finding uses a local template and is never sent to a model.</p>;
  return <div className="table-scroll"><table><caption>Exact bounded outbound cells (sanitised)</caption>
    <thead><tr><th>Cell</th><th>Formula</th><th>Cached type</th><th>Cached value</th><th>Format</th></tr></thead>
    <tbody>{Object.entries(evidence.cells).map(([ref, cell]) => <tr key={ref}><th scope="row">{ref}</th><td>{cell.f ?? '—'}</td><td>{cell.t}</td><td>{cell.v === null ? 'Unknown' : String(cell.v)}</td><td>{cell.fmt ?? 'Not included'}</td></tr>)}</tbody>
  </table></div>;
}

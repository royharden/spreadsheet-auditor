import type { WorkbookVersion } from '../../core/rulings/types.ts';
export function CarryOverPrompt({ versions, busy, onChoose }: { versions: readonly WorkbookVersion[]; busy: boolean; onChoose: (sha?: string) => void }) {
  return <section className="banner" aria-label="Choose workbook lineage"><h2>Carry rulings over?</h2>
    <p>This upload is not registered. Choose a prior version or start a new workbook before making a ruling.</p>
    <button type="button" disabled={busy} onClick={() => onChoose()}>Start a new workbook</button>
    <ul>{versions.map((version) => <li key={version.sha256}><button type="button" disabled={busy} onClick={() => onChoose(version.sha256)}>Link to {version.displayName || version.sha256.slice(0, 12)}</button></li>)}</ul>
  </section>;
}

export type Download = (name: string, content: string, mime: string) => void;
export const downloadFile: Download = (name, content, mime) => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
};
export function ExportBar({ disabled, onExport }: { disabled: boolean; onExport: (format: 'md' | 'json') => void }) {
  return <section aria-label="Export"><h2>Export report</h2><p>Exports include all findings, dismissed and set aside, plus local notes.</p>
    <button type="button" disabled={disabled} onClick={() => onExport('md')}>Download Markdown</button>{' '}
    <button type="button" disabled={disabled} onClick={() => onExport('json')}>Download JSON</button>
  </section>;
}

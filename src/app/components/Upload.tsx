export function Upload({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  return <section aria-label="Upload workbook">
    <label htmlFor="workbook">Choose a macro-free .xlsx workbook</label>
    <input id="workbook" type="file" accept=".xlsx" disabled={busy} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      if (file) onFile(file);
      // Permit choosing the same file again after a refusal or a changed workbook.
      event.currentTarget.value = '';
    }} />
    <p>Up to 5 MiB, 20 sheets and 50,000 formula cells. Cached values are inspected; formulas are not recalculated.</p>
  </section>;
}

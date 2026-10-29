export type Mode = 'template' | 'mock' | 'live';
export function ModeSwitch({ mode, reasons, busy, onChange }: { mode: Mode; reasons: readonly string[]; busy: boolean; onChange: (mode: Mode) => void }) {
  return <section aria-label="Explanation mode"><h2>Explanation mode</h2><div role="group" aria-label="Mode">
    {(['template', 'mock', 'live'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value}
      disabled={busy || (value === 'live' && reasons.length > 0)} onClick={() => onChange(value)}>{value === 'template' ? 'Template' : value === 'mock' ? 'Mock' : 'Live'}</button>)}
    </div>{reasons.length > 0 && <p>Live unavailable: {reasons.join('; ')}</p>}
    <p>Template stays local. Mock replays cached responses. Live sends only the bounded evidence you preview.</p>
  </section>;
}

import { useRef, useState } from 'react';
import type { Decision } from '../../core/rulings/types.ts';
export function RulingControls({ disabled, onRuling }: { disabled: boolean; onRuling: (decision: Decision, note: string) => Promise<void> }) {
  const [note, setNote] = useState(''); const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  async function choose(decision: Decision): Promise<void> {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try { await onRuling(decision, note); } finally { inFlight.current = false; setPending(false); }
  }
  return <fieldset disabled={disabled || pending}><legend>Your ruling</legend>
    <label>Note (local only; included in exports)<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <button type="button" onClick={() => { void choose('confirm'); }}>Confirm</button>{' '}
    <button type="button" onClick={() => { void choose('dismiss'); }}>Dismiss</button>{' '}
    <button type="button" onClick={() => { void choose('by_design'); }}>By design</button>
  </fieldset>;
}

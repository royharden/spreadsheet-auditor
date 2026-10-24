import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditResult, AuditedFinding } from '../../core/audit.ts';
import { replayRulings, type ReplayedRuling } from '../../core/rulings/replay.ts';
import type { Decision, Ruling, WorkbookVersion } from '../../core/rulings/types.ts';
import type { RulingsStore } from '../../storage/types.ts';

export function useRulings(audit: AuditResult | null, store: RulingsStore | null) {
  const [versions, setVersions] = useState<WorkbookVersion[]>([]);
  const [version, setVersion] = useState<WorkbookVersion | undefined>();
  const [events, setEvents] = useState<Ruling[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const current = ++epoch.current;
    pending.current = false;
    setVersions([]); setVersion(undefined); setEvents([]); setError(null); setLoading(true); setSaving(false);
    if (!audit || !store) return;
    void (async () => {
      const known = await store.listVersions();
      const exact = known.find((item) => item.sha256 === audit.workbook.sha256);
      const history = exact ? await store.listByLineage(exact.lineageId) : [];
      if (current !== epoch.current) return;
      setVersions(known); setVersion(exact); setEvents(history); setLoading(false);
    })().catch((reason: unknown) => { if (current === epoch.current) { setError(reason instanceof Error ? reason.message : 'Rulings could not be loaded.'); setLoading(false); } });
    return () => { epoch.current++; };
  }, [audit, store]);
  const needsChoice = Boolean(audit && !version && versions.length > 0);
  const rulings = useMemo<Record<string, ReplayedRuling>>(() => audit ? replayRulings({ workbookSha256: audit.workbook.sha256, findings: audit.findings, rulings: events, version }) : {}, [audit, events, version]);

  async function chooseVersion(linkedFrom?: string): Promise<void> {
    if (!audit || !store || loading || pending.current || error) return;
    const current = epoch.current;
    pending.current = true; setSaving(true); setError(null);
    try {
      const registered = await store.registerVersion({ sha256: audit.workbook.sha256, displayName: audit.workbook.name, ...(linkedFrom ? { linkedFrom } : {}) });
      if (current !== epoch.current) return;
      const history = await store.listByLineage(registered.lineageId);
      if (current !== epoch.current) return;
      const known = await store.listVersions();
      if (current !== epoch.current) return;
      setVersion(registered); setEvents(history); setVersions(known);
    } catch (reason) { if (current === epoch.current) setError(reason instanceof Error ? reason.message : 'Version registration failed.'); }
    finally { if (current === epoch.current) { pending.current = false; setSaving(false); } }
  }
  async function append(finding: AuditedFinding, decision: Decision, note: string): Promise<void> {
    if (!audit || !store || loading || error || needsChoice || pending.current) return;
    const current = epoch.current;
    pending.current = true; setSaving(true); setError(null);
    try {
      // With no prior versions, first ruling lazily registers a fresh lineage.
      const registered = version ?? await store.registerVersion({ sha256: audit.workbook.sha256, displayName: audit.workbook.name });
      if (current !== epoch.current) return;
      const ruling: Ruling = { eventId: crypto.randomUUID(), lineageId: registered.lineageId, workbookSha256: audit.workbook.sha256,
        ruleId: finding.ruleId, sheet: finding.sheet, cell: finding.cell, formulaHash: finding.formulaHash, decision,
        ...(note.trim() ? { note: note.trim() } : {}), noteLocalOnly: true, createdAt: new Date().toISOString() };
      await store.append(ruling);
      if (current !== epoch.current) return;
      const history = await store.listByLineage(registered.lineageId);
      if (current !== epoch.current) return;
      setVersion(registered); setEvents(history);
    } catch (reason) { if (current === epoch.current) setError(reason instanceof Error ? reason.message : 'Ruling could not be saved.'); }
    finally { if (current === epoch.current) { pending.current = false; setSaving(false); } }
  }
  return { versions, version, rulings, loading, saving, error, needsChoice, chooseVersion, append,
    disabled: !store || loading || saving || Boolean(error) || needsChoice };
}

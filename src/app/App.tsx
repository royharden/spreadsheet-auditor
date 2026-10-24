import { useEffect, useRef, useState } from 'react';
import type { AuditOutcome } from '../core/audit.ts';
import { MAX_COMPRESSED_BYTES } from '../core/sheetmodel/limits.ts';
import { openLocalRulingsStore, type Persistence } from '../storage/localAdapter.ts';
import type { AuditRequest, AuditResponse } from '../worker/protocol.ts';
import { Upload } from './components/Upload.tsx';
import { Summary } from './components/Summary.tsx';
import { FindingsTable } from './components/FindingsTable.tsx';
import './styles.css';

export const createAuditWorker = (): Worker => new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module' });

export function App({ workerFactory = createAuditWorker }: { workerFactory?: () => Worker }) {
  const [outcome, setOutcome] = useState<AuditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const active = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let mounted = true;
    // Merely opening storage does not register the uploaded workbook as a version (§8).
    void openLocalRulingsStore().then((store) => { if (mounted) setPersistence(store.persistence); });
    return () => {
      mounted = false;
      requestId.current++;
      active.current?.terminate();
      active.current = null;
    };
  }, []);

  async function audit(file: File): Promise<void> {
    const id = ++requestId.current;
    active.current?.terminate();
    active.current = null;
    setOutcome(null);
    if (file.size > MAX_COMPRESSED_BYTES) {
      setOutcome({ ok: false, refusal: { code: 'compressed-too-large', message: 'Choose a workbook of at most 5 MiB.' } });
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (id !== requestId.current) return;
      const worker = workerFactory();
      active.current = worker;
      const finish = (next: AuditOutcome): void => {
        if (id !== requestId.current) return;
        setOutcome(next);
        setBusy(false);
        worker.terminate();
        active.current = null;
      };
      worker.onmessage = (event: MessageEvent<AuditResponse>) => {
        if (event.data.type === 'audit-result' && event.data.id === id) finish(event.data.outcome);
      };
      worker.onerror = () => finish({ ok: false, failure: { message: 'The audit worker could not finish. Please try the workbook again.' } });
      worker.onmessageerror = () => finish({ ok: false, failure: { message: 'The audit worker returned an unreadable result.' } });
      const request: AuditRequest = { type: 'audit', id, fileName: file.name, bytes };
      worker.postMessage(request, [bytes]);
    } catch (error) {
      if (id !== requestId.current) return;
      active.current?.terminate();
      active.current = null;
      setOutcome({ ok: false, failure: { message: error instanceof Error ? error.message : 'The file could not be read.' } });
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Spreadsheet Auditor</h1>
      <p className="banner" role="note">Rulings are stored in this browser only; nothing is uploaded.</p>
      {persistence === 'memory' && <p role="status">Browser storage is unavailable. Rulings will be lost when this page closes.</p>}
      <Upload busy={busy} onFile={(file) => { void audit(file); }} />
      {busy && <p role="status">Auditing workbook in this browser…</p>}
      {outcome && !outcome.ok && <p className="error" role="alert">{'refusal' in outcome
        ? `Workbook refused (${outcome.refusal.code}): ${outcome.refusal.message}`
        : `Audit failed: ${outcome.failure.message}`}</p>}
      {outcome?.ok && <>
        <Summary audit={outcome.result} />
        <FindingsTable findings={outcome.result.findings} />
      </>}
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { AuditOutcome } from '../core/audit.ts';
import { MAX_COMPRESSED_BYTES } from '../core/sheetmodel/limits.ts';
import { openLocalRulingsStore, type Persistence } from '../storage/localAdapter.ts';
import type { AuditRequest, AuditResponse } from '../worker/protocol.ts';
import { Upload } from './components/Upload.tsx';
import { Summary } from './components/Summary.tsx';
import { FindingsTable } from './components/FindingsTable.tsx';
import './styles.css';
import { buildBudgetQ3 } from '../../generator/samples.ts';
import committedCache from '../../fixtures/model-cache.json';
import { supabase, explainFunctionUrl } from '../lib/supabase.ts';
import { openSupabaseRulingsStore } from '../storage/supabaseAdapter.ts';
import type { RulingsStore } from '../storage/types.ts';
import { useAuth, type AuthGateway } from './auth.ts';
import { useRulings } from './hooks/useRulings.ts';
import { AuthPanel } from './components/AuthPanel.tsx';
import { ModeSwitch, type Mode } from './components/ModeSwitch.tsx';
import { CarryOverPrompt } from './components/CarryOverPrompt.tsx';
import { FindingDetail } from './components/FindingDetail.tsx';
import { SetAsideList } from './components/SetAsideList.tsx';
import { BundlePreview } from './components/BundlePreview.tsx';
import { ExportBar, downloadFile, type Download } from './components/ExportBar.tsx';
import { createEdgeProvider, edgeReadiness, type EdgeOptions } from '../core/providers/edgeClient.ts';
import { createMockProvider } from '../core/providers/mock.ts';
import { cacheContext, cacheKey, parseCache } from '../core/providers/cache.ts';
import type { FetchTransport } from '../core/providers/types.ts';
import { selectTriage } from '../core/triage/select.ts';
import { triageAudit } from '../core/triage/run.ts';
import type { TriagedAudit } from '../core/triage/apply.ts';
import { priceFor } from '../core/callledger/prices.ts';
import { buildSyntheticDemoCache, SYNTHETIC_MODEL, SYNTHETIC_LABEL } from './demo/syntheticCache.ts';
import { createReport } from '../core/report/reportSchema.ts';
import { toJson } from '../core/report/toJson.ts';
import { toMarkdown } from '../core/report/toMarkdown.ts';
import type { ReplayedRuling } from '../core/rulings/replay.ts';

export const createAuditWorker = (): Worker => new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module' });

type AuditFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;
const localOrCloud = async (owner: string | null): Promise<RulingsStore> => owner && supabase ? openSupabaseRulingsStore(supabase, owner) : openLocalRulingsStore();
const browserTransport: FetchTransport = (url, init) => globalThis.fetch(url, init);
interface AppProps {
  workerFactory?: () => Worker;
  sampleBuilder?: (version: 1 | 2) => Uint8Array;
  authGateway?: AuthGateway | null;
  storeFactory?: (owner: string | null) => Promise<RulingsStore>;
  transport?: FetchTransport;
  functionUrl?: string | null;
  priceLookup?: typeof priceFor;
  download?: Download;
}
export function App({ workerFactory = createAuditWorker, sampleBuilder = buildBudgetQ3, authGateway = supabase?.auth ?? null,
  storeFactory = localOrCloud, transport = browserTransport, functionUrl = explainFunctionUrl, priceLookup = priceFor, download = downloadFile }: AppProps) {
  const auth = useAuth(authGateway);
  const owner = auth.loading ? 'auth-restoring' : auth.session?.user.id ?? 'local';
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [outcome, setOutcome] = useState<AuditOutcome | null>(null);
  const [outcomeOwner, setOutcomeOwner] = useState(owner);
  const visibleOutcome = outcomeOwner === owner ? outcome : null;
  const auditResult = visibleOutcome?.ok ? visibleOutcome.result : null;
  const auditRef = useRef(auditResult); auditRef.current = auditResult;
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [storeData, setStoreData] = useState<{ owner: string; store: RulingsStore } | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const store = storeData?.owner === owner ? storeData.store : null;
  const rulingSession = useRulings(auditResult, store);
  const [mode, setMode] = useState<Mode>('template');
  const [triaged, setTriaged] = useState<{ owner: string; sha: string; value: TriagedAudit } | null>(null);
  const effectiveTriage = triaged?.owner === owner && triaged.sha === auditResult?.workbook.sha256 ? triaged.value : undefined;
  const [triaging, setTriaging] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [readiness, setReadiness] = useState<{ owner: string; value: Awaited<ReturnType<typeof edgeReadiness>> } | null>(null);
  const triageId = useRef(0);
  const sessionRef = useRef(auth.session); sessionRef.current = auth.session;
  const active = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    return () => {
      requestId.current++;
      active.current?.terminate();
      active.current = null;
    };
  }, []);

  useEffect(() => {
    let current = true;
    requestId.current++; active.current?.terminate(); active.current = null; setBusy(false);
    setOutcome(null); setOutcomeOwner(owner);
    setStoreData(null); setStoreError(null); setPersistence(null);
    setTriaged(null); setMode('template'); setPreview(false); setUiError(null); setModelLabel(null);
    setTriaging(false);
    triageId.current++;
    if (!auth.loading) void storeFactory(auth.session?.user.id ?? null).then((next) => {
      if (!current) return;
      setStoreData({ owner, store: next });
      const persistenceValue = 'persistence' in next ? next.persistence : 'notePersistence' in next ? next.notePersistence : null;
      if (persistenceValue === 'memory' || persistenceValue === 'indexeddb' || persistenceValue === 'localstorage') setPersistence(persistenceValue);
    }).catch(() => { if (current) setStoreError('Ruling storage is unavailable. Rulings are disabled until storage can be opened.'); });
    return () => { current = false; };
  }, [owner, auth.loading, auth.session?.user.id, storeFactory]);

  useEffect(() => {
    let current = true;
    setReadiness(null);
    if (auth.session && !auth.loading && functionUrl) {
      const options: EdgeOptions = { url: functionUrl, accessToken: async () => sessionRef.current?.access_token ?? '', transport };
      void edgeReadiness(options).then((value) => { if (current) setReadiness({ owner, value }); })
        .catch(() => { if (current) setReadiness({ owner, value: { configured: false, reasons: ['Function readiness could not be checked.'] } }); });
    }
    return () => { current = false; };
  }, [owner, auth.loading, functionUrl, transport]);

  const liveReasons: string[] = [];
  const ready = readiness?.owner === owner ? readiness.value : null;
  if (!authGateway || !functionUrl) liveReasons.push('Backend configuration is missing');
  if (!auth.session || auth.loading) liveReasons.push('Sign in to use Live');
  if (!ready) liveReasons.push('Function readiness has not been verified');
  else if (!ready.configured) liveReasons.push(...ready.reasons);
  if (!ready?.model || !priceLookup(ready.model)) liveReasons.push('Verified dated pricing for the configured model is unavailable');

  async function runModel(nextMode: 'mock' | 'live'): Promise<void> {
    if (!auditResult || triaging || (nextMode === 'live' && liveReasons.length)) return;
    const id = ++triageId.current; const currentOwner = owner; const audit = auditResult;
    setTriaging(true); setUiError(null); setPreview(false);
    try {
      let result: TriagedAudit;
      if (nextMode === 'mock') {
        const synthetic = buildSyntheticDemoCache(audit);
        const saved = parseCache(committedCache);
        const entries = [...new Map([...saved.entries, ...synthetic].map((entry) => [entry.key, entry])).values()];
        const selection = selectTriage(audit, 'generative');
        const models = [...new Set(saved.entries.filter((entry) => entry.arm === 'generative').map((entry) => entry.model))].sort();
        const model = synthetic.length ? SYNTHETIC_MODEL : models.find((candidate) => selection.bundles.every((bundle) => entries.some((entry) => entry.key === cacheKey(bundle, cacheContext('generative', candidate))))) ?? models[0] ?? SYNTHETIC_MODEL;
        const cache = parseCache({ version: 1, entries: entries.filter((entry) => entry.arm === 'generative' && entry.model === model) });
        result = await triageAudit(audit, { provider: createMockProvider(cache), model, requestId: crypto.randomUUID(), arm: 'generative' });
        if (id === triageId.current && ownerRef.current === currentOwner) setModelLabel(!selection.bundles.length ? 'No eligible findings to triage.' : synthetic.length ? SYNTHETIC_LABEL : 'Mock replay — recorded cache response');
      } else {
        result = await triageAudit(audit, { provider: createEdgeProvider({ url: functionUrl!, accessToken: async () => sessionRef.current?.access_token ?? '', transport }), model: ready!.model!, requestId: crypto.randomUUID(), arm: 'generative' });
        if (id === triageId.current && ownerRef.current === currentOwner) setModelLabel('Live triage — citation checked');
      }
      if (id !== triageId.current || ownerRef.current !== currentOwner || auditRef.current?.workbook.sha256 !== audit.workbook.sha256) return;
      setTriaged({ owner: currentOwner, sha: audit.workbook.sha256, value: result });
    } catch (error) { if (id === triageId.current && ownerRef.current === currentOwner) setUiError(error instanceof Error ? error.message : 'Triage failed.'); }
    finally { if (id === triageId.current) setTriaging(false); }
  }

  const allFindings = effectiveTriage?.findings ?? auditResult?.findings ?? [];
  const currentRulings: Record<string, ReplayedRuling> = store ? rulingSession.rulings : {};
  const aside = (id: string): boolean => {
    const ruling = currentRulings[id];
    return ruling && !ruling.stale ? ruling.decision === 'by_design' : Boolean(effectiveTriage?.setAsideIds.includes(id));
  };
  const selected = allFindings.find((finding) => finding.id === selectedId) ?? allFindings[0];

  function exportReport(format: 'md' | 'json'): void {
    if (!auditResult || !store || rulingSession.loading) return;
    try {
      const report = createReport({ audit: auditResult, triaged: effectiveTriage, rulings: currentRulings, version: rulingSession.version,
        versions: rulingSession.versions, mode: effectiveTriage ? mode : 'template', generatedAt: new Date().toISOString() });
      download(`spreadsheet-audit.${format}`, format === 'json' ? toJson(report) : toMarkdown(report), format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8');
    } catch { setUiError('The report could not be exported.'); }
  }

  async function audit(file: AuditFile): Promise<void> {
    const id = ++requestId.current;
    active.current?.terminate();
    active.current = null;
    setOutcomeOwner(owner); setTriaged(null); setPreview(false); setMode('template'); setUiError(null); setModelLabel(null); setSelectedId(null);
    triageId.current++; setTriaging(false);
    setOutcome(null);
    if (file.size > MAX_COMPRESSED_BYTES) {
      setOutcome({ ok: false, refusal: { code: 'compressed-too-large', message: 'Choose a workbook of at most 5 MiB.' } });
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (id !== requestId.current || ownerRef.current !== owner) return;
      const worker = workerFactory();
      active.current = worker;
      const finish = (next: AuditOutcome): void => {
        if (id !== requestId.current || ownerRef.current !== owner) return;
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
      if (id !== requestId.current || ownerRef.current !== owner) return;
      active.current?.terminate();
      active.current = null;
      setOutcome({ ok: false, failure: { message: error instanceof Error ? error.message : 'The file could not be read.' } });
      setBusy(false);
    }
  }

  function loadSample(version: 1 | 2): void {
    try {
      const generated = sampleBuilder(version);
      // Copy into an owned ArrayBuffer before transferring it to the worker.
      const bytes = new Uint8Array(generated.length);
      bytes.set(generated);
      void audit({ name: version === 1 ? 'budget-q3.xlsx' : 'budget-q3-v2.xlsx', size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) });
    } catch (error) {
      setOutcome({ ok: false, failure: { message: error instanceof Error ? error.message : 'The sample could not be generated.' } });
    }
  }

  return (
    <main>
      <h1>Spreadsheet Auditor</h1>
      <p className="banner" role="note">{store?.kind === 'cloud' ? 'Ruling metadata syncs to your account. Workbook files stay in this browser; notes stay on this device.' : mode === 'live' ? 'Rulings stay in this browser. Live sends only the evidence you preview.' : 'Rulings are stored in this browser only; nothing is uploaded.'}</p>
      {persistence === 'memory' && <p role="status">{store?.kind === 'cloud' ? 'Ruling metadata syncs, but local note text will be lost when this page closes.' : 'Browser storage is unavailable. Rulings will be lost when this page closes.'}</p>}
      <AuthPanel key={owner} auth={authGateway} session={auth.session} recovering={auth.recovering} onRecovered={() => auth.setRecovering(false)} />
      {auth.error && <p role="alert">{auth.error}</p>}
      <ModeSwitch mode={mode} busy={busy || triaging} reasons={liveReasons} onChange={(next) => {
        if (next === 'live' && liveReasons.length) return;
        setMode(next); setUiError(null); setPreview(next === 'live'); setTriaged(null); setModelLabel(null);
        if (next === 'template') { triageId.current++; setTriaged(null); setModelLabel(null); }
        if (next === 'mock') void runModel('mock');
      }} />
      <Upload busy={busy || triaging || auth.loading} onFile={(file) => { void audit(file); }} />
      <p><button type="button" disabled={busy || triaging || auth.loading} onClick={() => loadSample(1)}>Load sample</button>{' '}
        <button type="button" disabled={busy || triaging || auth.loading} onClick={() => loadSample(2)}>Load sample v2</button></p>
      {busy && <p role="status">Auditing workbook in this browser…</p>}
      {visibleOutcome && !visibleOutcome.ok && <p className="error" role="alert">{'refusal' in visibleOutcome
        ? `Workbook refused (${visibleOutcome.refusal.code}): ${visibleOutcome.refusal.message}`
        : `Audit failed: ${visibleOutcome.failure.message}`}</p>}
      {(uiError || storeError || rulingSession.error) && <p role="alert">{uiError ?? storeError ?? rulingSession.error}</p>}
      {auditResult && <>
        <Summary audit={auditResult} />
        {modelLabel && <p>{modelLabel}</p>}
        {triaging && <p role="status">Checking bounded evidence…</p>}
        <p>{effectiveTriage?.notTriaged ?? allFindings.filter((finding) => finding.tier !== 'confirmed').length} findings not triaged; code templates retained.</p>
        {effectiveTriage?.issues.length ? <details><summary>Triage fallbacks</summary><ul>{effectiveTriage.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details> : null}
        {rulingSession.loading && <p role="status">Loading prior rulings…</p>}
        {rulingSession.needsChoice && <CarryOverPrompt versions={rulingSession.versions} busy={rulingSession.saving} onChoose={(sha) => { void rulingSession.chooseVersion(sha); }} />}
        {preview && mode === 'live' && <BundlePreview bundles={selectTriage(auditResult, 'generative').bundles} busy={triaging} onSend={() => { void runModel('live'); }} onCancel={() => { setPreview(false); setMode('template'); }} />}
        <FindingsTable findings={allFindings.filter((finding) => !aside(finding.id))} onSelect={setSelectedId} />
        <SetAsideList findings={allFindings.filter((finding) => aside(finding.id))} onSelect={setSelectedId} />
        {selected && <FindingDetail key={`${owner}:${auditResult.workbook.sha256}:${selected.id}`} finding={selected} ruling={currentRulings[selected.id]}
          disabled={rulingSession.disabled || busy || triaging} onRuling={(decision, note) => rulingSession.append(selected, decision, note)} />}
        <ExportBar disabled={!store || rulingSession.loading || rulingSession.saving || triaging || preview} onExport={exportReport} />
      </>}
    </main>
  );
}

import type { AuditResult } from '../../src/core/audit.ts';
import { CallLedger, type LedgerRow } from '../../src/core/callledger/ledger.ts';
import { choiceOutputBound, priceFor } from '../../src/core/callledger/prices.ts';
import { MAX_OUTPUT_TOKENS } from '../../src/core/explain/limits.ts';
import { buildPrompt, buildTypeSafeRequest, type TriageArm } from '../../src/core/explain/prompt.ts';
import { createAnthropicProvider } from '../../src/core/providers/anthropic.ts';
import { cacheContext, cacheEntry, type CacheEntry, type ModelCache } from '../../src/core/providers/cache.ts';
import { createMockProvider } from '../../src/core/providers/mock.ts';
import { createTypeSafeProvider } from '../../src/core/providers/typesafe.ts';
import type { FetchTransport, TriageProvider } from '../../src/core/providers/types.ts';
import { applyTriage } from '../../src/core/triage/apply.ts';
import { selectTriage } from '../../src/core/triage/select.ts';
import { utf8ByteLength } from '../../src/core/util/canonicalJson.ts';
import type { Observation } from '../../src/core/evalkit/resultsTable.ts';

export interface ModelSettings { mode: 'replay' | 'live'; generativeModel: string | null; jevModel: string | null; budgetUsd: number | null; anthropicKey: string; typesafeKey: string }
export function modelFor(settings: ModelSettings, system: '2' | '3'): string | null { return system === '2' ? settings.generativeModel : settings.jevModel; }
export function modelUnavailable(settings: ModelSettings, system: '2' | '3', cache: ModelCache): string | null {
  const model = modelFor(settings, system);
  if (!model) return 'An explicit server-configured model id is missing.';
  if (settings.mode === 'replay') {
    if (cache.entries.some((entry) => entry.origin === 'synthetic-test')) return 'Synthetic cache is not measurement evidence; not run.';
    if (!cache.entries.some((entry) => entry.model === model && entry.arm === (system === '2' ? 'generative' : 'jev') && entry.origin === 'recorded-live')) return 'No recorded-live cache evidence exists for this model/arm.';
  } else {
    if (settings.budgetUsd === null) return 'A finite EVAL_BUDGET_USD is required.';
    if (!priceFor(model)) return 'Verified dated prices are missing; live calls are denied before transport.';
    if (system === '3' && choiceOutputBound(priceFor(model)!) === null) return 'Jev live evaluation is not run: a documented service-enforced worst-case output bound is unverified.';
    if (!(system === '2' ? settings.anthropicKey : settings.typesafeKey)) return 'The server-only provider key is missing.';
  }
  return null;
}
export interface ModelObservation { observation: Observation; ledger: LedgerRow[]; recordings: CacheEntry[] }
export async function evaluateModelAudit(audit: AuditResult, workbook: string, system: '2' | '3', model: string, requestId: string,
  provider: TriageProvider, ledgerRows: LedgerRow[] = []): Promise<ModelObservation> {
  if (provider.origin === 'synthetic-test') throw new Error('Synthetic responses cannot be measured as model evidence.');
  const arm: TriageArm = system === '2' ? 'generative' : 'jev';
  const selection = selectTriage(audit, arm);
  const started = Date.now();
  const response = selection.bundles.length ? await provider.triage({ requestId, arm, model, bundles: selection.bundles }) : [];
  const applied = applyTriage(audit, selection, response, arm);
  const measuredRows: LedgerRow[] = ledgerRows.length ? ledgerRows : selection.bundles.length ? [{ ts: new Date().toISOString(), arm, model, requestId, bundles: selection.bundles.length,
    inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, costUsd: null, status: provider.origin === 'recorded-live' ? 'replay' : 'live' }] : [];
  const recordable = response.length === selection.bundles.length && response.every((row) => response.filter((other) => other.findingId === row.findingId).length === 1 &&
    selection.bundles.some((bundle) => bundle.findingId === row.findingId && bundle.sha256 === row.bundleSha256));
  return { observation: { workbook, findings: applied.findings, setAsideIds: applied.setAsideIds,
    ledger: measuredRows }, ledger: measuredRows,
    recordings: recordable ? response.flatMap((row) => { const bundle = selection.bundles.find((item) => item.findingId === row.findingId); return bundle ? [cacheEntry(bundle, cacheContext(arm, model), row, 'recorded-live')] : []; }) : [] };
}
/** Construct live adapters only after both readiness and durable reservation gates passed. */
export function evaluationProvider(settings: ModelSettings, system: '2' | '3', cache: ModelCache, audit: AuditResult, requestId: string,
  ledger: CallLedger, transport: FetchTransport): { provider: TriageProvider; reservedUsd: number; rows: LedgerRow[] } {
  const reason = modelUnavailable(settings, system, cache);
  if (reason) throw new Error(reason);
  if (settings.mode === 'replay') return { provider: createMockProvider(cache), reservedUsd: 0, rows: [] };
  const model = modelFor(settings, system)!;
  const arm: TriageArm = system === '2' ? 'generative' : 'jev';
  const selection = selectTriage(audit, arm);
  const prompt = buildPrompt(selection.bundles, arm);
  const body = system === '2' ? { model, max_tokens: MAX_OUTPUT_TOKENS, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] } : buildTypeSafeRequest(model, selection.bundles);
  // Include a conservative metadata overhead beyond the exact serialised API request.
  const outputBound = system === '3' ? choiceOutputBound(priceFor(model)!)! : MAX_OUTPUT_TOKENS;
  const reservedUsd = selection.bundles.length ? ledger.reserve(model, utf8ByteLength(JSON.stringify(body)) + 4096, outputBound) : 0;
  const rows: LedgerRow[] = [];
  const options = { model, apiKey: system === '2' ? settings.anthropicKey : settings.typesafeKey, transport,
    onAttempt: (usage: Parameters<CallLedger['record']>[1]) => { rows.push(ledger.record({ arm, model, requestId, bundles: selection.bundles.length }, usage, rows.length ? 0 : reservedUsd)); } };
  return { provider: system === '2' ? createAnthropicProvider(options) : createTypeSafeProvider(options), reservedUsd, rows };
}

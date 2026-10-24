// Activation only: this module is constructed but never invoked during Dirty Mode.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOCATION, manifestCounts, type Split, type TemplateId } from '../generator/build.ts';
import { runAudit } from '../src/core/audit.ts';
import { parseManifest, normalizeWorkbook, type ManifestRow } from '../src/core/evalkit/manifest.ts';
import {
  TEMPLATE_PROMPT_VERSION, buildSystemResult, jevDisposition, jevSentence, notRunResult, renderFailures, renderResults,
  type EvaluationReport, type Observation, type PairMetadata, type SystemId, type SystemResult,
} from '../src/core/evalkit/resultsTable.ts';
import { canonicalJson } from '../src/core/util/canonicalJson.ts';
import { sha256Hex } from '../src/core/util/sha256.ts';
import { PROMPT_VERSION } from '../src/core/explain/prompt.ts';
import { parseCache, type CacheEntry, type ModelCache } from '../src/core/providers/cache.ts';
import { CallLedger, type LedgerRow } from '../src/core/callledger/ledger.ts';
import { evaluateModelAudit, evaluationProvider, modelFor, modelUnavailable, type ModelObservation, type ModelSettings } from './lib/modelEvaluation.ts';
import { completeTask, finishRun, pendingTasks, pinsHash, readRunFile, saveRunFile, startOrResume, withRunLease, type RunLock, type RunPins } from './lib/heldoutLock.ts';

export interface EvalOptions { split: Split; systems: SystemId[]; countsOnly: boolean; record: boolean; corpusRoot: string; resultsRoot: string; mode: 'replay' | 'live'; cachePath: string }
export interface DiskWorkbook extends PairMetadata { split: Split; templateId: TemplateId; seed: number; cleanTwin: string; injectedTwin: string }
interface CorpusIndex { seed: number; generatorVersion: string; workbooks: DiskWorkbook[] }
interface Freeze { seed: number; generatorVersion: string; fileSha256: Record<string, string>; manifestSha256: string; freezeDate: string }
export interface DiskCorpus { manifest: ManifestRow[]; entries: DiskWorkbook[]; bytes: Map<string, Uint8Array>; manifestSha256: string; corpusSha256: string; frozen: boolean }
interface Checkpoint { schemaVersion: 1; taskId: string; pinsSha256: string; observation: Observation; recordings?: CacheEntry[] }

export function parseEvalArgs(args: readonly string[]): EvalOptions {
  const options: EvalOptions = { split: 'dev', systems: ['1'], countsOnly: false, record: false, corpusRoot: resolve('fixtures/workbooks'), resultsRoot: resolve('results'), mode: 'replay', cachePath: resolve('fixtures/model-cache.json') };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--counts-only') options.countsOnly = true;
    else if (arg === '--record') options.record = true;
    else if (['--split', '--systems', '--corpus', '--results', '--mode', '--cache'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--split') {
        if (value !== 'dev' && value !== 'heldout') throw new Error('Unknown split.');
        options.split = value;
      } else if (arg === '--systems') {
        const systems = value.split(',');
        if (!systems.length || systems.some((system) => system !== '1' && system !== '2' && system !== '3') || new Set(systems).size !== systems.length) throw new Error('Systems must be distinct ids 1,2,3.');
        options.systems = (systems as SystemId[]).sort();
      } else if (arg === '--mode') { if (value !== 'replay' && value !== 'live') throw new Error('Mode must be replay or live.'); options.mode = value; }
      else if (arg === '--cache') options.cachePath = resolve(value);
      else if (arg === '--corpus') options.corpusRoot = resolve(value);
      else options.resultsRoot = resolve(value);
    } else throw new Error(`Unknown evaluation argument: ${arg}`);
  }
  return options;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected text.'); return value; }
function safePath(root: string, relative: string): string {
  if (isAbsolute(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').some((part) => part === '..' || part === '')) throw new Error('Unsafe corpus path.');
  const path = resolve(root, relative);
  if (!path.toLowerCase().startsWith(`${resolve(root).toLowerCase()}${sep}`)) throw new Error('Corpus path escaped root.');
  return path;
}

function parseIndex(value: unknown): CorpusIndex {
  const source = record(value);
  if (!Number.isInteger(source.seed) || !Array.isArray(source.workbooks)) throw new Error('Invalid corpus index.');
  const workbooks = source.workbooks.map((item: unknown): DiskWorkbook => {
    const entry = record(item);
    const split = text(entry.split);
    const templateId = text(entry.templateId);
    const variant = text(entry.variant);
    if ((split !== 'dev' && split !== 'heldout') || !ALLOCATION.some((allocation) => allocation.split === split && allocation.templateId === templateId) ||
      (variant !== 'clean' && variant !== 'injected') || !Number.isInteger(entry.seed)) throw new Error('Invalid corpus entry allocation.');
    const workbook = text(entry.workbook);
    if (!workbook.startsWith(`${split}/`) || !workbook.endsWith('.xlsx')) throw new Error('Invalid corpus workbook path.');
    return { workbook, split, templateId: templateId as TemplateId, seed: entry.seed as number, variant, pairId: text(entry.pairId), cleanTwin: text(entry.cleanTwin), injectedTwin: text(entry.injectedTwin) };
  });
  if (new Set(workbooks.map((entry) => normalizeWorkbook(entry.workbook))).size !== workbooks.length) throw new Error('Duplicate corpus workbook.');
  for (const entry of workbooks) {
    const twin = workbooks.find((candidate) => candidate.pairId === entry.pairId && candidate.variant !== entry.variant);
    if (!twin || twin.split !== entry.split || twin.templateId !== entry.templateId || twin.seed !== entry.seed || twin.cleanTwin !== entry.cleanTwin || twin.injectedTwin !== entry.injectedTwin ||
      entry.workbook !== (entry.variant === 'clean' ? entry.cleanTwin : entry.injectedTwin)) throw new Error('Invalid explicit injection twin metadata.');
  }
  for (const allocation of ALLOCATION) {
    if (workbooks.filter((entry) => entry.split === allocation.split && entry.templateId === allocation.templateId).length !== allocation.pairs * 2) throw new Error('Corpus index differs from the allocation table.');
  }
  return { seed: source.seed as number, generatorVersion: text(source.generatorVersion), workbooks };
}

function parseFreeze(value: unknown): Freeze {
  const source = record(value);
  const hashes = record(source.fileSha256);
  if (!Number.isInteger(source.seed) || typeof source.freezeDate !== 'string' || !Number.isFinite(Date.parse(source.freezeDate)) || typeof source.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.manifestSha256) ||
    Object.values(hashes).some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid freeze.');
  return { seed: source.seed as number, generatorVersion: text(source.generatorVersion), fileSha256: hashes as Record<string, string>, manifestSha256: source.manifestSha256, freezeDate: source.freezeDate };
}

/** Reads actual artifacts; it never calls the generator or substitutes in-memory synthetic bytes. */
export async function loadDiskCorpus(options: EvalOptions): Promise<DiskCorpus> {
  const manifestBytes = await readFile(resolve(options.corpusRoot, 'manifest.json'));
  const indexBytes = await readFile(resolve(options.corpusRoot, 'CORPUS.json'));
  const allManifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  const index = parseIndex(JSON.parse(indexBytes.toString('utf8')) as unknown);
  let freeze: Freeze | null = null;
  let freezeSha256: string | null = null;
  try {
    const freezeBytes = await readFile(resolve(options.corpusRoot, 'FREEZE.json'));
    freeze = parseFreeze(JSON.parse(freezeBytes.toString('utf8')) as unknown);
    freezeSha256 = sha256Hex(freezeBytes);
  } catch (error) {
    if (!options.countsOnly || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const manifestSha256 = sha256Hex(manifestBytes);
  if (freeze && (freeze.manifestSha256 !== manifestSha256 || freeze.fileSha256['CORPUS.json'] !== sha256Hex(indexBytes) || freeze.seed !== index.seed || freeze.generatorVersion !== index.generatorVersion)) throw new Error('Frozen manifest/index digest or generator identity changed.');
  const entries = index.workbooks.filter((entry) => entry.split === options.split);
  if (entries.length !== 40) throw new Error('Expected 40 workbooks in the selected split.');
  const selected = new Set(entries.map((entry) => normalizeWorkbook(entry.workbook)));
  const allNames = new Set(index.workbooks.map((entry) => normalizeWorkbook(entry.workbook)));
  if (allManifest.some((row) => !allNames.has(normalizeWorkbook(row.workbook)))) throw new Error('Manifest names an unknown workbook.');
  const manifest = allManifest.filter((row) => selected.has(normalizeWorkbook(row.workbook)));
  if (entries.some((entry) => !manifest.some((row) => normalizeWorkbook(row.workbook) === normalizeWorkbook(entry.workbook)))) throw new Error('Workbook has no oracle rows.');
  const bytes = new Map<string, Uint8Array>();
  const measuredHashes: Record<string, string> = { 'CORPUS.json': sha256Hex(indexBytes) };
  if (!options.countsOnly) {
    if (!freeze) throw new Error('Evaluation requires an actual FREEZE.json.');
    for (const entry of entries) {
      const file = await readFile(safePath(options.corpusRoot, entry.workbook));
      const hash = sha256Hex(file);
      if (freeze.fileSha256[entry.workbook] !== hash) throw new Error(`Workbook digest changed: ${entry.workbook}`);
      measuredHashes[entry.workbook] = hash;
      bytes.set(entry.workbook, file);
    }
  }
  return { manifest, entries, bytes, manifestSha256, corpusSha256: sha256Hex(canonicalJson({ files: measuredHashes, freezeSha256 })), frozen: freeze !== null };
}

interface EvaluationPins extends RunPins { modelIds: { generative: string | null; jev: string | null }; cacheSha256: string; cacheOrigins: string[]; providerMode: string }
export function modelSettings(options: EvalOptions): ModelSettings {
  const budget = process.env.EVAL_BUDGET_USD;
  const parsedBudget = budget !== undefined && budget.trim() !== '' ? Number(budget) : null;
  return { mode: options.mode, generativeModel: process.env.EXPLAIN_MODEL?.trim() || null, jevModel: process.env.JEV_MODEL?.trim() || null,
    budgetUsd: parsedBudget !== null && Number.isFinite(parsedBudget) && parsedBudget >= 0 ? parsedBudget : null,
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '', typesafeKey: process.env.TYPESAFE_API_KEY ?? '' };
}
export async function evaluationPins(options: EvalOptions, corpus: DiskCorpus): Promise<EvaluationPins> {
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // A commit id only pins executed source if the relevant working files agree with it.
  const changes = execFileSync('git', ['status', '--porcelain', '--', 'src', 'generator', 'scripts', 'config', 'package.json', 'tsconfig.json', 'tsconfig.node.json'], { encoding: 'utf8' });
  if (changes.trim()) throw new Error('Commit evaluation source and configuration before a frozen run.');
  let prompt: Uint8Array;
  try { prompt = await readFile(resolve('src/core/explain/prompt.ts')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    prompt = await readFile(resolve('src/core/explain/templates.ts'));
  }
  const thresholds = await readFile(resolve('config/thresholds.json'));
  const settings = modelSettings(options);
  const cacheBytes = await readFile(options.cachePath);
  const cache = parseCache(JSON.parse(cacheBytes.toString('utf8')) as unknown);
  const modelIds = { generative: settings.generativeModel, jev: settings.jevModel };
  const cacheSha256 = sha256Hex(cacheBytes);
  const cacheOrigins = [...new Set(cache.entries.map((entry) => entry.origin))].sort();
  return {
    corpusSha256: corpus.corpusSha256, manifestSha256: corpus.manifestSha256, gitCommit,
    promptSha256: sha256Hex(canonicalJson({ version: PROMPT_VERSION, templateVersion: TEMPLATE_PROMPT_VERSION, sourceSha256: sha256Hex(prompt) })),
    thresholdsSha256: sha256Hex(thresholds), modelIdsSha256: sha256Hex(canonicalJson({ modelIds, cacheSha256, cacheOrigins, mode: options.mode })), systems: options.systems,
    modelIds, cacheSha256, cacheOrigins, providerMode: options.mode,
  };
}

function checkpointPath(root: string, taskId: string): string { return resolve(root, 'checkpoints', `${sha256Hex(taskId)}.json`); }
function validateCheckpoint(value: unknown, taskId: string, pins: RunPins, workbook: string): Checkpoint {
  const checkpoint = record(value);
  if (checkpoint.schemaVersion !== 1 || checkpoint.taskId !== taskId || checkpoint.pinsSha256 !== pinsHash(pins)) throw new Error('Checkpoint pins/task changed.');
  const observation = record(checkpoint.observation);
  if (observation.workbook !== workbook || !Array.isArray(observation.findings) || !Array.isArray(observation.setAsideIds) || !Array.isArray(observation.ledger)) throw new Error('Malformed observation checkpoint.');
  if (checkpoint.recordings !== undefined) {
    const cache = parseCache({ version: 1, entries: checkpoint.recordings });
    if (cache.entries.some((entry) => entry.origin !== 'recorded-live')) throw new Error('Checkpoint contains synthetic measurement recordings.');
  }
  return checkpoint as unknown as Checkpoint;
}

async function systemOne(options: EvalOptions, corpus: DiskCorpus, pins: RunPins, lockPath?: string, initial?: RunLock): Promise<{ observations: Observation[]; state?: RunLock }> {
  let state = initial;
  const observations: Observation[] = [];
  await mkdir(resolve(options.resultsRoot, 'checkpoints'), { recursive: true });
  for (const entry of corpus.entries) {
    const taskId = `1:${entry.workbook}`;
    const path = checkpointPath(options.resultsRoot, taskId);
    let checkpoint: Checkpoint | null = null;
    let checkpointText: string | null = null;
    if (state) {
      try {
        checkpointText = await readFile(path, 'utf8');
        checkpoint = validateCheckpoint(JSON.parse(checkpointText) as unknown, taskId, pins, entry.workbook);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (state.completed[taskId] !== undefined && (!checkpointText || sha256Hex(checkpointText) !== state.completed[taskId])) throw new Error('Completed receipt is missing or changed.');
    }
    if (!checkpoint) {
      const bytes = corpus.bytes.get(entry.workbook);
      if (!bytes) throw new Error('Missing verified workbook bytes.');
      const audit = runAudit(bytes, { fileName: entry.workbook });
      checkpoint = { schemaVersion: 1, taskId, pinsSha256: pinsHash(pins), observation: { workbook: entry.workbook, findings: audit.findings, setAsideIds: [], ledger: [] } };
      checkpointText = `${canonicalJson(checkpoint)}\n`;
      if (state) await writeFile(path, checkpointText, { flag: 'wx' });
    }
    observations.push(checkpoint.observation);
    // Recover a fully written receipt after a crash without rerunning its audit.
    if (state && state.completed[taskId] === undefined && checkpointText !== null) {
      state = completeTask(state, taskId, sha256Hex(checkpointText), new Date().toISOString());
      if (!lockPath) throw new Error('Missing progress path.');
      await saveRunFile(lockPath, state);
    }
  }
  return { observations, ...(state ? { state } : {}) };
}

async function modelSystem(options: EvalOptions, corpus: DiskCorpus, pins: RunPins, system: '2' | '3', settings: ModelSettings,
  cache: ModelCache, history: LedgerRow[], recordings: CacheEntry[], lockPath?: string, initial?: RunLock): Promise<{ observations: Observation[]; state?: RunLock }> {
  let state = initial;
  const observations: Observation[] = [];
  await mkdir(resolve(options.resultsRoot, 'checkpoints'), { recursive: true });
  for (const entry of corpus.entries) {
    const taskId = `${system}:${entry.workbook}`;
    const path = checkpointPath(options.resultsRoot, taskId);
    let checkpoint: Checkpoint | null = null;
    let checkpointText: string | null = null;
    if (state) {
      try { checkpointText = await readFile(path, 'utf8'); checkpoint = validateCheckpoint(JSON.parse(checkpointText) as unknown, taskId, pins, entry.workbook); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (state.completed[taskId] !== undefined && (!checkpointText || sha256Hex(checkpointText) !== state.completed[taskId])) throw new Error('Model checkpoint changed or is missing.');
    }
    if (!checkpoint) {
      const model = modelFor(settings, system);
      if (!model) throw new Error('Missing pinned model.');
      const bytes = corpus.bytes.get(entry.workbook);
      if (!bytes) throw new Error('Missing verified workbook bytes.');
      const audit = runAudit(bytes, { fileName: entry.workbook });
      const requestId = randomUUID();
      const receiptPath = `${path}.provider-receipt.json`;
      let recovered: ModelObservation | null = null;
      if (settings.mode === 'live') {
        try {
          const receipt = record(JSON.parse(await readFile(receiptPath, 'utf8')) as unknown);
          if (receipt.pinsSha256 !== pinsHash(pins) || receipt.taskId !== taskId || receipt.model !== model || receipt.status !== 'complete') throw new Error('A prior model reservation is incomplete or ambiguous; reconcile its receipt before resuming.');
          const result = record(receipt.result);
          validateCheckpoint({ schemaVersion: 1, taskId, pinsSha256: pinsHash(pins), observation: result.observation }, taskId, pins, entry.workbook);
          if (!Array.isArray(result.ledger) || !Array.isArray(result.recordings)) throw new Error('Malformed provider receipt.');
          recovered = result as unknown as ModelObservation;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      let result: ModelObservation;
      if (recovered) result = recovered;
      else {
        const ledger = new CallLedger(settings.budgetUsd ?? 0, history);
        const prepared = evaluationProvider(settings, system, cache, audit, requestId, ledger, globalThis.fetch.bind(globalThis));
        // The durable reservation precedes transport. An ambiguous interrupted call is never
        // automatically repeated; a complete receipt can recover without another paid call.
        const receipt = { pinsSha256: pinsHash(pins), taskId, model, requestId, reservedUsd: prepared.reservedUsd };
        if (settings.mode === 'live') await writeFile(receiptPath, `${canonicalJson({ ...receipt, status: 'reserved' })}\n`, { flag: 'wx' });
        try {
          result = await evaluateModelAudit(audit, entry.workbook, system, model, requestId, prepared.provider, prepared.rows);
          if (settings.mode === 'live') await writeFile(receiptPath, `${canonicalJson({ ...receipt, status: 'complete', result })}\n`);
        } catch (error) {
          if (settings.mode === 'live') await writeFile(receiptPath, `${canonicalJson({ ...receipt, status: 'failed', ledger: prepared.rows })}\n`);
          throw error;
        }
      }
      history.push(...result.ledger);
      checkpoint = { schemaVersion: 1, taskId, pinsSha256: pinsHash(pins), observation: result.observation, recordings: result.recordings };
      checkpointText = `${canonicalJson(checkpoint)}\n`;
      if (state) await writeFile(path, checkpointText, { flag: 'wx' });
    }
    observations.push(checkpoint.observation);
    // Recovered checkpoints retain their original recordings too; --record output must not
    // discard pre-interruption calls merely because those calls were correctly not repeated.
    if (options.record && settings.mode === 'live') recordings.push(...(checkpoint.recordings ?? []));
    if (state && state.completed[taskId] === undefined && checkpointText !== null) {
      state = completeTask(state, taskId, sha256Hex(checkpointText), new Date().toISOString());
      if (!lockPath) throw new Error('Missing model progress path.');
      await saveRunFile(lockPath, state);
    }
  }
  return { observations, ...(state ? { state } : {}) };
}

/** Idempotent finalization precedes the completed lock. Atomic replacements preserve previous
 * ledger rows/cache contexts, so a crash between these writes can safely retry finalization. */
export async function finalizeArtifacts(root: string, shouldRecord: boolean, recordings: readonly CacheEntry[], history: readonly LedgerRow[]): Promise<void> {
  const atomic = async (name: string, text: string): Promise<void> => {
    const path = resolve(root, name);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, path);
  };
  if (shouldRecord) {
    let prior: ModelCache = { version: 1, entries: [] };
    try { prior = parseCache(JSON.parse(await readFile(resolve(root, 'recorded-cache.json'), 'utf8')) as unknown); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const entries = [...new Map([...prior.entries, ...recordings].map((entry) => [entry.key, entry])).values()];
    await atomic('recorded-cache.json', `${canonicalJson({ version: 1, entries })}\n`);
  }
  if (history.length) {
    let previous: string[] = [];
    try { previous = (await readFile(resolve(root, 'ledger.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // Reject a corrupt old row instead of silently dropping prior spend evidence.
    const rows = new Set([...previous.map((line) => canonicalJson(JSON.parse(line) as unknown)), ...history.map((row) => canonicalJson(row))]);
    await atomic('ledger.jsonl', `${[...rows].join('\n')}\n`);
  }
}

export async function writeReports(root: string, report: EvaluationReport): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'results.md'), renderResults(report));
  await writeFile(resolve(root, 'failures.md'), renderFailures(report));
  await appendFile(resolve(root, 'results.jsonl'), `${canonicalJson(report)}\n`);
  // M7 supplies README; later evaluation updates only this generated block.
  try {
    const path = resolve('README.md');
    const readme = await readFile(path, 'utf8');
    const block = `<!-- EVAL-RESULTS:BEGIN -->\n${report.jevSentence}\n\n[Recorded evaluation results](results/results.md)\n<!-- EVAL-RESULTS:END -->`;
    const pattern = /<!-- EVAL-RESULTS:BEGIN -->[\s\S]*?<!-- EVAL-RESULTS:END -->/;
    await writeFile(path, pattern.test(readme) ? readme.replace(pattern, block) : `${readme.trimEnd()}\n\n${block}\n`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function evaluate(options: EvalOptions): Promise<EvaluationReport | null> {
  const corpus = await loadDiskCorpus(options);
  if (options.countsOnly) {
    process.stdout.write(`${canonicalJson({ status: 'labels-only', frozen: corpus.frozen, split: options.split, workbooks: corpus.entries.length, counts: manifestCounts(corpus.manifest.map((row) => ({ ...row, caseName: row.caseName ?? '' }))) })}\n`);
    return null;
  }
  const pins = await evaluationPins(options, corpus);
  const cache = parseCache(JSON.parse(await readFile(options.cachePath, 'utf8')) as unknown);
  const settings = modelSettings(options);
  const unavailable = new Map((['2', '3'] as const).map((system) => [system, modelUnavailable(settings, system, cache)]));
  const activeSystems = options.systems.filter((system) => system === '1' || unavailable.get(system) === null);
  const tasks = activeSystems.flatMap((system) => corpus.entries.map((entry) => `${system}:${entry.workbook}`));
  const thresholds = record(JSON.parse(await readFile(resolve('config/thresholds.json'), 'utf8')) as unknown);
  if (!Number.isSafeInteger(thresholds.jevMaxSetAsideDefects) || typeof thresholds.jevMaxSetAsideDefects !== 'number' || thresholds.jevMaxSetAsideDefects < 0) throw new Error('Invalid Jev threshold.');
  await mkdir(options.resultsRoot, { recursive: true });
  const run = async (lockPath?: string): Promise<EvaluationReport> => {
    let state: RunLock | undefined;
    if (lockPath) {
      state = startOrResume(await readRunFile(lockPath), pins, tasks, new Date().toISOString());
      await saveRunFile(lockPath, state);
    }
    const systems: SystemResult[] = [];
    const history: LedgerRow[] = [];
    const recordings: CacheEntry[] = [];
    if (state) for (const task of tasks.filter((id) => !id.startsWith('1:'))) {
      try {
        const checkpoint = validateCheckpoint(JSON.parse(await readFile(checkpointPath(options.resultsRoot, task), 'utf8')) as unknown, task, pins, task.slice(2));
        history.push(...checkpoint.observation.ledger as LedgerRow[]);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (options.systems.includes('1')) {
      const result = await systemOne(options, corpus, pins, lockPath, state);
      state = result.state;
      systems.push(buildSystemResult('1', 'template', corpus.manifest, result.observations, corpus.entries));
    }
    for (const system of options.systems) if (system !== '1') {
      const reason = unavailable.get(system);
      if (reason) { systems.push(notRunResult(system, reason)); continue; }
      // Cache miss/provider failure invalidates that model system's measurement; partial
      // workbook observations never masquerade as a complete corpus result.
      const result = await modelSystem(options, corpus, pins, system, settings, cache, history, recordings, lockPath, state);
      state = result.state;
      systems.push(buildSystemResult(system, settings.mode === 'live' ? 'live' : 'recorded-live', corpus.manifest, result.observations, corpus.entries));
    }
    const outcome = jevDisposition(systems, thresholds.jevMaxSetAsideDefects as number);
    const report: EvaluationReport = { schemaVersion: 1, generatedAt: new Date().toISOString(), split: options.split, pins: { ...pins }, systems, jevOutcome: outcome, jevSentence: jevSentence(outcome) };
    await writeReports(options.resultsRoot, report);
    if (systems.some((system) => system.status === 'complete' && !system.citationInvariantPassed)) process.exitCode = 1;
    // Output is separate from the immutable input cache pinned above. Promote deliberately
    // for later replay; never mutate the cache underneath a running experiment.
    await finalizeArtifacts(options.resultsRoot, options.record, recordings, history);
    if (state && lockPath && pendingTasks(state).length === 0) await saveRunFile(lockPath, finishRun(state, new Date().toISOString()));
    return report;
  };
  if (options.split === 'heldout' && tasks.length > 0) {
    const path = resolve(options.resultsRoot, 'HELDOUT-RUN.json');
    return withRunLease(path, () => run(path));
  }
  return run();
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  evaluate(parseEvalArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

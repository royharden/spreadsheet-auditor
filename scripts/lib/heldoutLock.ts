import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../src/core/util/canonicalJson.ts';
import { sha256Hex } from '../../src/core/util/sha256.ts';
import type { SystemId } from '../../src/core/evalkit/resultsTable.ts';

export interface RunPins {
  corpusSha256: string;
  manifestSha256: string;
  gitCommit: string;
  promptSha256: string;
  thresholdsSha256: string;
  modelIdsSha256: string;
  systems: SystemId[];
}
export interface RunLock {
  schemaVersion: 1;
  pins: RunPins;
  tasks: string[];
  completed: Record<string, string>;
  status: 'active' | 'complete';
  receipts: { event: 'created' | 'resumed' | 'task-completed' | 'run-completed'; at: string; taskId?: string }[];
}

export function pinsHash(pins: RunPins): string { return sha256Hex(canonicalJson(pins)); }

function validatePins(pins: RunPins): void {
  for (const key of ['corpusSha256', 'manifestSha256', 'promptSha256', 'thresholdsSha256', 'modelIdsSha256'] as const) {
    if (!/^[a-f0-9]{64}$/.test(pins[key])) throw new Error(`Invalid pin ${key}.`);
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pins.gitCommit)) throw new Error('Invalid git commit pin.');
  if (!pins.systems.length || new Set(pins.systems).size !== pins.systems.length || pins.systems.some((system) => !['1', '2', '3'].includes(system))) throw new Error('Invalid pinned systems.');
}

/** No reset path exists: only missing task receipts under the exact original pins may resume. */
export function startOrResume(existing: RunLock | null, pins: RunPins, tasks: readonly string[], at: string): RunLock {
  validatePins(pins);
  if (!tasks.length || new Set(tasks).size !== tasks.length) throw new Error('Expected tasks must be nonempty and unique.');
  const ordered = [...tasks].sort();
  if (existing === null) return { schemaVersion: 1, pins, tasks: ordered, completed: {}, status: 'active', receipts: [{ event: 'created', at }] };
  if (existing.schemaVersion !== 1 || !Array.isArray(existing.tasks) || !Array.isArray(existing.receipts) || !existing.completed || typeof existing.completed !== 'object') throw new Error('Malformed run lock.');
  if (pinsHash(existing.pins) !== pinsHash(pins) || canonicalJson(existing.tasks) !== canonicalJson(ordered)) throw new Error('Run pins changed; a new experiment requires a fresh corpus.');
  if (existing.status === 'complete') throw new Error('This experiment is complete and cannot repeat.');
  if (existing.status !== 'active' || Object.entries(existing.completed).some(([task, hash]) => !ordered.includes(task) || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid run progress.');
  return { ...existing, receipts: [...existing.receipts, { event: 'resumed', at }] };
}

export function pendingTasks(state: RunLock): string[] { return state.tasks.filter((task) => state.completed[task] === undefined); }

export function completeTask(state: RunLock, taskId: string, receiptSha256: string, at: string): RunLock {
  if (state.status !== 'active' || !state.tasks.includes(taskId) || !/^[a-f0-9]{64}$/.test(receiptSha256)) throw new Error('Invalid task completion.');
  if (state.completed[taskId] !== undefined) throw new Error('Completed task cannot be repeated.');
  return { ...state, completed: { ...state.completed, [taskId]: receiptSha256 }, receipts: [...state.receipts, { event: 'task-completed', at, taskId }] };
}

export function finishRun(state: RunLock, at: string): RunLock {
  if (state.status !== 'active' || pendingTasks(state).length) throw new Error('Cannot complete a run with missing tasks.');
  return { ...state, status: 'complete', receipts: [...state.receipts, { event: 'run-completed', at }] };
}

export async function readRunFile(path: string): Promise<RunLock | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as RunLock; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveRunFile(path: string, state: RunLock): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${canonicalJson(state)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

/**
 * A separate process lease prevents concurrent resumes from executing the same missing task.
 * Any existing lease is preserved and blocks entry until explicit manual recovery.
 */
export async function withRunLease<T>(path: string, work: () => Promise<T>): Promise<T> {
  const leasePath = `${path}.lease`;
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(leasePath, 'wx'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`Run lease already exists at ${leasePath}; no work was started. Stop all evaluator invocations and verify the lease is abandoned before manually renaming it to a unique evidence path. Do not delete it. See docs/DEFERRED-VALIDATION.md.`);
  }
  try {
    await handle.writeFile(canonicalJson({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    return await work();
  } finally {
    await handle.close();
    await unlink(leasePath);
  }
}

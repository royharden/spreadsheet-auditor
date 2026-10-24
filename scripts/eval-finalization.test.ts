import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finalizeArtifacts } from './eval.ts';
import type { CacheEntry } from '../src/core/providers/cache.ts';
import type { LedgerRow } from '../src/core/callledger/ledger.ts';
describe('resumable model finalization', () => {
  it('preserves prior recordings and ledger rows and makes a retry idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 's24-finalization-'));
    const entry: CacheEntry = { key: 'a'.repeat(64), origin: 'recorded-live', promptVersion: 'triage-v1', schemaVersion: '1', arm: 'generative', model: 'fixture',
      response: { findingId: 'a'.repeat(12), bundleSha256: 'b'.repeat(64), triage: 'unclear', explanation: 'A1 needs review.', cited_cells: ['A1'] } };
    const row: LedgerRow = { ts: '2026-10-24T00:00:00Z', arm: 'generative', model: 'fixture', requestId: 'fixture', bundles: 1, inputTokens: null, outputTokens: null, latencyMs: 3, costUsd: null, status: 'replay' };
    await writeFile(join(root, 'recorded-cache.json'), JSON.stringify({ version: 1, entries: [entry] }));
    await writeFile(join(root, 'ledger.jsonl'), `${JSON.stringify(row)}\n`);
    const next = { ...entry, key: 'c'.repeat(64) };
    await finalizeArtifacts(root, true, [next], [row]);
    await finalizeArtifacts(root, true, [next], [row]);
    expect((JSON.parse(await readFile(join(root, 'recorded-cache.json'), 'utf8')) as { entries: unknown[] }).entries).toHaveLength(2);
    expect((await readFile(join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
  it('finalizes artifacts before marking the experiment complete and reloads prior recordings', async () => {
    const source = await readFile(resolve('scripts/eval.ts'), 'utf8');
    expect(source.indexOf('await finalizeArtifacts(options.resultsRoot')).toBeLessThan(source.indexOf('saveRunFile(lockPath, finishRun(state'));
    expect(source).toContain('recordings.push(...(checkpoint.recordings ?? []))');
  });
});

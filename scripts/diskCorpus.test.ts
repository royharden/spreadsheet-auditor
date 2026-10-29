import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOCATION } from '../generator/build.ts';
import { sha256Hex } from '../src/core/util/sha256.ts';
import { loadDiskCorpus, parseEvalArgs } from './eval.ts';

const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string, encoding?: string) => {
    const bytes = files.get(path);
    if (!bytes) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
    return encoding ? Buffer.from(bytes).toString(encoding as BufferEncoding) : Buffer.from(bytes);
  }),
  appendFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), open: vi.fn(), rename: vi.fn(), unlink: vi.fn(),
}));

const options = parseEvalArgs(['--corpus', 'oracle-fixture']);
const root = options.corpusRoot;

function putJson(name: string, value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  files.set(resolve(root, name), bytes);
  return bytes;
}

function diskFixture(): void {
  files.clear();
  const workbooks = [];
  const manifest = [];
  const fileSha256: Record<string, string> = {};
  for (const allocation of ALLOCATION) for (let pair = 1; pair <= allocation.pairs; pair++) {
    const pairId = `${allocation.split}-${allocation.templateId}-${pair}`;
    const cleanTwin = `${allocation.split}/${pairId}-clean.xlsx`;
    const injectedTwin = `${allocation.split}/${pairId}-injected.xlsx`;
    for (const variant of ['clean', 'injected'] as const) {
      const workbook = variant === 'clean' ? cleanTwin : injectedTwin;
      workbooks.push({ ...allocation, workbook, seed: pair, pairId, variant, cleanTwin, injectedTwin });
      manifest.push({ workbook, sheet: 'S', cell: 'A1', primaryRule: 'ERROR_VALUE', truth: 'defect', role: 'primary', denominatorEligible: true, also_ok_rules: [] });
      // These bytes exercise disk/digest loading only, never the XLSX reader or generator.
      const bytes = new TextEncoder().encode(`disk fixture ${workbook}`);
      files.set(resolve(root, workbook), bytes);
      fileSha256[workbook] = sha256Hex(bytes);
    }
  }
  const manifestBytes = putJson('manifest.json', manifest);
  const indexBytes = putJson('CORPUS.json', { seed: 7, generatorVersion: 'fixture-version', workbooks });
  fileSha256['CORPUS.json'] = sha256Hex(indexBytes);
  putJson('FREEZE.json', { seed: 7, generatorVersion: 'fixture-version', fileSha256, manifestSha256: sha256Hex(manifestBytes), freezeDate: '2026-01-01T00:00:00.000Z' });
}

describe('disk oracle and freeze verification', () => {
  beforeEach(diskFixture);

  it('loads verified selected bytes and labels, including explicit twin metadata', async () => {
    const corpus = await loadDiskCorpus(options);
    expect(corpus.entries).toHaveLength(40);
    expect(corpus.manifest).toHaveLength(40);
    expect(corpus.bytes.size).toBe(40);
    expect(corpus.frozen).toBe(true);
    expect(corpus.corpusSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(corpus.entries[0].cleanTwin).toContain('clean.xlsx');
  });

  it('refuses changed workbook or manifest bytes rather than silently regenerating them', async () => {
    const corpus = await loadDiskCorpus(options);
    files.set(resolve(root, corpus.entries[0].workbook), new Uint8Array([99]));
    await expect(loadDiskCorpus(options)).rejects.toThrow('digest changed');
    diskFixture();
    const rows = JSON.parse(Buffer.from(files.get(resolve(root, 'manifest.json'))!).toString('utf8')) as Record<string, unknown>[];
    rows[0].cell = 'B2';
    putJson('manifest.json', rows);
    await expect(loadDiskCorpus(options)).rejects.toThrow('digest');
  });

  it('requires a freeze for scoring, while counts-only may inspect unfrozen labels without loading workbook bytes', async () => {
    files.delete(resolve(root, 'FREEZE.json'));
    await expect(loadDiskCorpus(options)).rejects.toThrow('ENOENT');
    const inspected = await loadDiskCorpus({ ...options, countsOnly: true });
    expect(inspected.frozen).toBe(false);
    expect(inspected.bytes.size).toBe(0);
  });

  it('binds the freeze and index metadata into the corpus digest', async () => {
    const first = await loadDiskCorpus(options);
    const freeze = JSON.parse(Buffer.from(files.get(resolve(root, 'FREEZE.json'))!).toString('utf8')) as Record<string, unknown>;
    freeze.freezeDate = '2026-01-02T00:00:00.000Z';
    putJson('FREEZE.json', freeze);
    expect((await loadDiskCorpus(options)).corpusSha256).not.toBe(first.corpusSha256);
  });
});

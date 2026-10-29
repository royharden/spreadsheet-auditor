// Activation only. Dirty Mode constructs this source but never invokes it.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorpus, DEFAULT_SEED, type GeneratedWorkbook } from '../generator/build.ts';
import { canonicalJson } from '../src/core/util/canonicalJson.ts';
import { sha256Hex } from '../src/core/util/sha256.ts';

export interface GenerateOptions {
  seed: number;
  output: string;
  freeze: boolean;
}

export function parseGenerateArgs(args: readonly string[]): GenerateOptions {
  const options: GenerateOptions = { seed: DEFAULT_SEED, output: resolve('fixtures/workbooks'), freeze: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--freeze') options.freeze = true;
    else if (arg === '--seed' || arg === '--output') {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--seed') {
        if (!/^\d+$/.test(value)) throw new Error('Seed must be a uint32.');
        options.seed = Number(value);
        if (!Number.isInteger(options.seed) || options.seed > 0xffffffff) throw new Error('Seed must be a uint32.');
      } else options.output = resolve(value);
    } else throw new Error(`Unknown generator argument: ${arg}`);
  }
  return options;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function metadata(entry: GeneratedWorkbook): Omit<GeneratedWorkbook, 'bytes' | 'manifest'> {
  const { bytes: _bytes, manifest: _manifest, ...rest } = entry;
  return rest;
}

/** Exclusive writes refuse to replace a corpus or an existing freeze. Hashes are measured bytes. */
export async function generateWorkbooks(options: GenerateOptions): Promise<void> {
  const freezePath = resolve(options.output, 'FREEZE.json');
  if (await exists(freezePath)) throw new Error('This corpus is frozen; choose a new output directory.');
  const corpus = buildCorpus(options.seed);
  const manifestText = `${canonicalJson(corpus.manifest)}\n`;
  const indexText = `${canonicalJson({ seed: corpus.seed, generatorVersion: corpus.generatorVersion, workbooks: corpus.workbooks.map(metadata) })}\n`;
  const planned = [...corpus.workbooks.map((entry) => entry.workbook), 'manifest.json', 'CORPUS.json'];
  // Preflight every target before the first file write, then still use wx against races.
  for (const relative of planned) {
    if (await exists(resolve(options.output, relative))) throw new Error(`Refusing to overwrite ${relative}.`);
  }
  const fileSha256: Record<string, string> = {};
  for (const entry of corpus.workbooks) {
    const path = resolve(options.output, entry.workbook);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.bytes, { flag: 'wx' });
    fileSha256[entry.workbook] = sha256Hex(entry.bytes);
  }
  await mkdir(options.output, { recursive: true });
  await writeFile(resolve(options.output, 'manifest.json'), manifestText, { flag: 'wx' });
  await writeFile(resolve(options.output, 'CORPUS.json'), indexText, { flag: 'wx' });
  fileSha256['CORPUS.json'] = sha256Hex(indexText);
  if (options.freeze) {
    await writeFile(freezePath, `${canonicalJson({
      seed: corpus.seed,
      generatorVersion: corpus.generatorVersion,
      fileSha256,
      manifestSha256: sha256Hex(manifestText),
      freezeDate: new Date().toISOString(),
    })}\n`, { flag: 'wx' });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateWorkbooks(parseGenerateArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

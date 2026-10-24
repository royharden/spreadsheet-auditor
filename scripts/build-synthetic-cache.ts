// Activation only: writes the same scoped demo entries used in browser memory.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBudgetQ3 } from '../generator/samples.ts';
import { buildSyntheticDemoCache } from '../src/app/demo/syntheticCache.ts';
import { runAudit } from '../src/core/audit.ts';
import { canonicalJson } from '../src/core/util/canonicalJson.ts';
export async function buildSyntheticCache(): Promise<void> {
  const entries = [1, 2].flatMap((version) => buildSyntheticDemoCache(runAudit(buildBudgetQ3(version as 1 | 2))));
  const unique = [...new Map(entries.map((entry) => [entry.key, entry])).values()];
  await writeFile(resolve('fixtures/model-cache.json'), `${canonicalJson({ version: 1, entries: unique })}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void buildSyntheticCache();

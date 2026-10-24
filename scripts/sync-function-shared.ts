// Activation only. Never run in Dirty Mode; backend construction copies these files manually.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SHARED_FILES = {
  'prompt.ts': 'src/core/explain/prompt.ts', 'triageSchema.ts': 'src/core/explain/triageSchema.ts',
  'limits.ts': 'src/core/explain/limits.ts', 'canonicalJson.ts': 'src/core/util/canonicalJson.ts', 'sha256.ts': 'src/core/util/sha256.ts',
} as const;
export async function syncFunctionShared(): Promise<void> {
  for (const [name, source] of Object.entries(SHARED_FILES)) {
    const target = resolve('supabase/functions/explain-findings/_shared', name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(source), target);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void syncFunctionShared();

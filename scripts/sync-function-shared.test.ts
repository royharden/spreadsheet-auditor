import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARED_FILES } from './sync-function-shared.ts';
describe('canonical edge shared source', () => {
  it('keeps all five copies byte-identical without invoking the sync script', async () => {
    for (const [name, source] of Object.entries(SHARED_FILES)) expect(await readFile(resolve('supabase/functions/explain-findings/_shared', name))).toEqual(await readFile(resolve(source)));
  });
});

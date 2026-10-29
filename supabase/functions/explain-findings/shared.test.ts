import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('edge deployment source contracts', () => {
  it('ships actual byte-identical copies of all five canonical shared modules', async () => {
    const files = [
      ['prompt.ts', 'src/core/explain/prompt.ts'], ['triageSchema.ts', 'src/core/explain/triageSchema.ts'],
      ['limits.ts', 'src/core/explain/limits.ts'], ['canonicalJson.ts', 'src/core/util/canonicalJson.ts'], ['sha256.ts', 'src/core/util/sha256.ts'],
    ];
    for (const [name, canonical] of files) {
      const copy = resolve('supabase/functions/explain-findings/_shared', name);
      expect(await readFile(copy)).toEqual(await readFile(resolve(canonical)));
      const imports = [...(await readFile(copy, 'utf8')).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      expect(imports.every((specifier) => specifier === 'zod' || /^\.\/[^/]+\.ts$/.test(specifier))).toBe(true);
    }
    const map = JSON.parse(await readFile(resolve('supabase/functions/explain-findings/import_map.json'), 'utf8')) as { imports: Record<string, string> };
    expect(map.imports.zod).toMatch(/^npm:zod@4\./);
  });
  it('keeps JWT verification enabled, verifies users explicitly, and contains no content logging', async () => {
    expect(await readFile(resolve('supabase/config.toml'), 'utf8')).toContain('verify_jwt = true');
    const index = await readFile(resolve('supabase/functions/explain-findings/index.ts'), 'utf8');
    expect(index).toContain('.auth.getUser(jwt)');
    for (const name of ['index.ts', 'handler.ts', 'transport.ts', 'validate.ts']) {
      const source = await readFile(resolve('supabase/functions/explain-findings', name), 'utf8');
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug)|Deno\.(?:stdout|stderr)/);
    }
  });
});

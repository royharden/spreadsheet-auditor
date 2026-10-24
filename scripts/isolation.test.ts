import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(root, entry.name)) : Promise.resolve([resolve(root, entry.name)])));
  return nested.flat();
}

describe('heldout isolation boundary', () => {
  it('keeps every src/template/config file free of heldout routing literals', async () => {
    const paths = (await Promise.all(['src', 'generator/templates', 'config'].map((root) => files(resolve(root))))).flat();
    const violations: string[] = [];
    for (const path of paths) if (/heldout/i.test(await readFile(path, 'utf8'))) violations.push(path);
    expect(violations).toEqual([]);
  });
});

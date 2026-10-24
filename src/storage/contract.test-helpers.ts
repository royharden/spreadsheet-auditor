// Shared RulingsStore contract suite (PLAN §8, M2.7, M6.2). Every adapter's test file calls
// `runRulingsStoreContract(label, makeStore)` with a factory that returns a fresh, empty store,
// so local and cloud adapters are held to one semantics. Test-only (imports vitest); the file
// name does not match `*.test.ts`, so it is not collected on its own.

import { describe, expect, it } from 'vitest';
import type { Ruling } from '../core/rulings/types.ts';
import { isStorageError, type RulingsStore, type StorageErrorCode } from './types.ts';

export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);
export const SHA_C = 'c'.repeat(64);

let eventCounter = 0;

/** A valid ruling for `sha256`/`lineageId`; override any field. */
export function sampleRuling(sha256: string, lineageId: string, overrides: Partial<Ruling> = {}): Ruling {
  eventCounter++;
  return {
    eventId: `00000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`,
    lineageId,
    workbookSha256: sha256,
    ruleId: 'ERROR_VALUE',
    sheet: 'Budget',
    cell: 'B5',
    formulaHash: `v1:${'0'.repeat(64)}`,
    decision: 'confirm',
    noteLocalOnly: true,
    createdAt: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

async function storageCode(p: Promise<unknown>): Promise<StorageErrorCode | 'resolved' | 'other-error'> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return isStorageError(err) ? err.code : 'other-error';
  }
}

export function runRulingsStoreContract(label: string, makeStore: () => RulingsStore | Promise<RulingsStore>): void {
  describe(`RulingsStore contract: ${label}`, () => {
    it('registers a new version in a new lineage, and re-registering returns it unchanged', async () => {
      const store = await makeStore();
      const v = await store.registerVersion({ sha256: SHA_A, displayName: 'budget-q3.xlsx' });
      expect(v).toMatchObject({ sha256: SHA_A, displayName: 'budget-q3.xlsx' });
      expect(v.lineageId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(v.linkedFromSha256).toBeUndefined();
      const again = await store.registerVersion({ sha256: SHA_A, displayName: 'renamed.xlsx' });
      expect(again).toEqual(v);
      expect(await store.listVersions()).toEqual([v]);
    });

    it('links a new version into the target lineage', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1.xlsx' });
      const b = await store.registerVersion({ sha256: SHA_B, displayName: 'v2.xlsx', linkedFrom: SHA_A });
      expect(b.lineageId).toBe(a.lineageId);
      expect(b.linkedFromSha256).toBe(SHA_A);
      const c = await store.registerVersion({ sha256: SHA_C, displayName: 'other.xlsx' });
      expect(c.lineageId).not.toBe(a.lineageId);
      expect((await store.listVersions()).map((v) => v.sha256)).toEqual([SHA_A, SHA_B, SHA_C]);
    });

    it("keeps a registered version's lineage final", async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'a' });
      const c = await store.registerVersion({ sha256: SHA_C, displayName: 'c' });
      const relinked = await store.registerVersion({ sha256: SHA_C, displayName: 'c', linkedFrom: SHA_A });
      expect(relinked.lineageId).toBe(c.lineageId);
      expect(relinked.lineageId).not.toBe(a.lineageId);
    });

    it('refuses a link to an unregistered version, a self-link and malformed hashes', async () => {
      const store = await makeStore();
      expect(await storageCode(store.registerVersion({ sha256: SHA_B, displayName: 'x', linkedFrom: SHA_A }))).toBe(
        'link-target-missing',
      );
      expect(await storageCode(store.registerVersion({ sha256: SHA_A, displayName: 'x', linkedFrom: SHA_A }))).toBe(
        'invalid-version',
      );
      expect(await storageCode(store.registerVersion({ sha256: 'ABC', displayName: 'x' }))).toBe('invalid-version');
      expect(await storageCode(store.registerVersion({ sha256: SHA_A, displayName: 'n'.repeat(256) }))).toBe('invalid-version');
      expect(await store.listVersions()).toEqual([]);
    });

    it('appends rulings and lists them by workbook and by lineage, in append order', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1' });
      const b = await store.registerVersion({ sha256: SHA_B, displayName: 'v2', linkedFrom: SHA_A });
      const r1 = sampleRuling(SHA_A, a.lineageId, { cell: 'B5' });
      const r2 = sampleRuling(SHA_A, a.lineageId, { cell: 'C7', decision: 'dismiss', note: 'checked with finance' });
      const r3 = sampleRuling(SHA_B, b.lineageId, { cell: 'B5', decision: 'by_design' });
      for (const r of [r1, r2, r3]) await store.append(r);
      expect(await store.listByWorkbook(SHA_A)).toEqual([r1, r2]);
      expect(await store.listByWorkbook(SHA_B)).toEqual([r3]);
      expect(await store.listByLineage(a.lineageId)).toEqual([r1, r2, r3]);
      expect(await store.listByWorkbook(SHA_C)).toEqual([]);
    });

    it('treats a repeated eventId as a no-op (first write wins)', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1' });
      const r = sampleRuling(SHA_A, a.lineageId);
      await store.append(r);
      await store.append(r);
      await store.append({ ...r, decision: 'dismiss' });
      expect(await store.listByWorkbook(SHA_A)).toEqual([r]);
    });

    it('refuses a ruling on an unregistered version or with a mismatched lineage', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1' });
      const c = await store.registerVersion({ sha256: SHA_C, displayName: 'other' });
      expect(await storageCode(store.append(sampleRuling(SHA_B, a.lineageId)))).toBe('version-not-registered');
      expect(await storageCode(store.append(sampleRuling(SHA_A, c.lineageId)))).toBe('lineage-mismatch');
      expect(await store.listByLineage(a.lineageId)).toEqual([]);
    });

    it('refuses malformed rulings', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1' });
      const bad: Partial<Ruling>[] = [
        { eventId: 'not-a-uuid' },
        { cell: 'b5' },
        { cell: 'A0' },
        { cell: 'XFE1' },
        { decision: 'maybe' as unknown as Ruling['decision'] },
        { ruleId: 'VOLATILE' as unknown as Ruling['ruleId'] },
        { formulaHash: 'abc' },
        { formulaHash: 'v1:incomplete' },
        { createdAt: 'yesterday' },
      ];
      for (const o of bad) expect(await storageCode(store.append(sampleRuling(SHA_A, a.lineageId, o)))).toBe('invalid-ruling');
      expect(await store.listByWorkbook(SHA_A)).toEqual([]);
    });

    it('serialises concurrent appends without losing any', async () => {
      const store = await makeStore();
      const a = await store.registerVersion({ sha256: SHA_A, displayName: 'v1' });
      const rs = Array.from({ length: 8 }, (_, i) => sampleRuling(SHA_A, a.lineageId, { cell: `A${i + 1}` }));
      await Promise.all(rs.map((r) => store.append(r)));
      expect((await store.listByWorkbook(SHA_A)).map((r) => r.eventId).sort()).toEqual(rs.map((r) => r.eventId).sort());
    });
  });
}

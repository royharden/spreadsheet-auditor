import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRulingsStoreContract, sampleRuling, SHA_A } from './contract.test-helpers.ts';
import {
  STORE_KEY,
  createLocalRulingsStore,
  localStorageBackend,
  memoryBackend,
  openLocalRulingsStore,
  type KeyValueBackend,
  type StorageLike,
} from './localAdapter.ts';
import { isStorageError } from './types.ts';

/** In-memory stand-in for window.localStorage. */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
}

let n = 0;
const ids = (): string => {
  n++;
  return `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
};
const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');

runRulingsStoreContract('local adapter over an in-memory backend', () =>
  createLocalRulingsStore(memoryBackend(), { newId: ids, now: fixedNow }),
);
runRulingsStoreContract('local adapter over a fake localStorage', () =>
  createLocalRulingsStore(localStorageBackend(new FakeStorage()), { newId: ids, now: fixedNow }),
);

describe('local adapter: persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to localStorage when IndexedDB cannot open', async () => {
    const storage = new FakeStorage();
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('blocked'); } });
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: storage.setItem.bind(storage), removeItem: (key: string) => storage.map.delete(key) });
    const store = await openLocalRulingsStore({ newId: ids, now: fixedNow });
    expect(store.persistence).toBe('localstorage');
    await store.registerVersion({ sha256: SHA_A, displayName: 'fallback.xlsx' });
    expect(storage.map.has(STORE_KEY)).toBe(true);
    expect(storage.map.has(`${STORE_KEY}.probe`)).toBe(false);
  });

  it('reports memory-only storage when both browser backends are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', undefined);
    const store = await openLocalRulingsStore({ newId: ids, now: fixedNow });
    expect(store.persistence).toBe('memory');
    expect(await store.listVersions()).toEqual([]);
  });

  it('reports its persistence kind and that it is local', () => {
    const store = createLocalRulingsStore(localStorageBackend(new FakeStorage()));
    expect(store.kind).toBe('local');
    expect(store.persistence).toBe('localstorage');
    expect(createLocalRulingsStore(memoryBackend()).persistence).toBe('memory');
  });

  it('keeps rulings across store instances over the same backing store (a page reload)', async () => {
    const storage = new FakeStorage();
    const first = createLocalRulingsStore(localStorageBackend(storage), { newId: ids, now: fixedNow });
    const v = await first.registerVersion({ sha256: SHA_A, displayName: 'budget.xlsx' });
    const r = sampleRuling(SHA_A, v.lineageId, { note: 'local only' });
    await first.append(r);
    const second = createLocalRulingsStore(localStorageBackend(storage), { newId: ids, now: fixedNow });
    expect(await second.listVersions()).toEqual([v]);
    expect(await second.listByWorkbook(SHA_A)).toEqual([r]);
    expect(storage.map.has(STORE_KEY)).toBe(true);
  });

  it('refuses to overwrite a corrupt stored document', async () => {
    const storage = new FakeStorage();
    storage.map.set(STORE_KEY, '{not json');
    const store = createLocalRulingsStore(localStorageBackend(storage));
    const err = await store.listVersions().catch((e: unknown) => e);
    expect(isStorageError(err) && err.code).toBe('backend-failure');
    expect(storage.map.get(STORE_KEY)).toBe('{not json');
  });

  it('surfaces a failed write as backend-failure and keeps working afterwards', async () => {
    const storage = new FakeStorage();
    const store = createLocalRulingsStore(localStorageBackend(storage), { newId: ids, now: fixedNow });
    storage.failWrites = true;
    const err = await store.registerVersion({ sha256: SHA_A, displayName: 'x' }).catch((e: unknown) => e);
    expect(isStorageError(err) && err.code).toBe('backend-failure');
    storage.failWrites = false;
    await expect(store.registerVersion({ sha256: SHA_A, displayName: 'x' })).resolves.toMatchObject({ sha256: SHA_A });
  });

  it('reads and writes through the backend interface only', async () => {
    const calls: string[] = [];
    const inner = memoryBackend();
    const spy: KeyValueBackend = {
      persistence: 'memory',
      get: (k) => {
        calls.push(`get:${k}`);
        return inner.get(k);
      },
      set: (k, v) => {
        calls.push(`set:${k}`);
        return inner.set(k, v);
      },
    };
    const store = createLocalRulingsStore(spy, { newId: ids, now: fixedNow });
    await store.registerVersion({ sha256: SHA_A, displayName: 'x' });
    expect(calls).toEqual([`get:${STORE_KEY}`, `set:${STORE_KEY}`]);
  });
});

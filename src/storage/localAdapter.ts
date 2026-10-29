// Local RulingsStore (PLAN §8): rulings and versions kept in this browser only, in IndexedDB
// when available, else localStorage, else memory (nothing persists; the UI says so). Notes stay
// here too (they are local-only everywhere, §2 #1).
//
// Storage layout: one JSON document `{version: 1, versions, rulings}` under one key, rewritten
// whole on each change. Operations on one store instance are serialised through a promise
// chain; two tabs writing at once can still race (last write wins) - see DEFERRED-VALIDATION.

import { MAX_DISPLAY_NAME, SHA256_HEX_RE, rulingProblems, type Ruling, type WorkbookVersion } from '../core/rulings/types.ts';
import { StorageError, type RegisterVersionInput, type RulingsStore } from './types.ts';

export type Persistence = 'indexeddb' | 'localstorage' | 'memory';

/** The minimal async key-value backing store the adapter needs. */
export interface KeyValueBackend {
  readonly persistence: Persistence;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** The part of the Web Storage API the localStorage backend uses (fakeable in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORE_KEY = 'spreadsheet-auditor.rulings.v1';
const IDB_NAME = 'spreadsheet-auditor';
const IDB_STORE = 'kv';

interface StoreDocument {
  version: 1;
  versions: WorkbookVersion[];
  rulings: Ruling[];
}

// ---------------------------------------------------------------------------------------------
// Backends

export function memoryBackend(): KeyValueBackend {
  const map = new Map<string, string>();
  return {
    persistence: 'memory',
    get: (key) => Promise.resolve(map.get(key) ?? null),
    set: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}

export function localStorageBackend(storage: StorageLike): KeyValueBackend {
  return {
    persistence: 'localstorage',
    get: (key) => Promise.resolve(storage.getItem(key)),
    set: (key, value) => {
      try {
        storage.setItem(key, value);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(new StorageError('backend-failure', `localStorage write failed: ${String(err)}`));
      }
    },
  };
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError('backend-failure', `IndexedDB request failed: ${String(req.error)}`));
  });
}

export function indexedDbBackend(factory: IDBFactory, dbName: string = IDB_NAME): KeyValueBackend {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError('backend-failure', `IndexedDB open failed: ${String(req.error)}`));
      req.onblocked = () => reject(new StorageError('backend-failure', 'IndexedDB open was blocked by another tab'));
    });
    return dbPromise;
  };
  return {
    persistence: 'indexeddb',
    async get(key) {
      const db = await open();
      const value = await requestResult(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key));
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      const db = await open();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new StorageError('backend-failure', `IndexedDB write failed: ${String(tx.error)}`));
        tx.onabort = () => reject(new StorageError('backend-failure', `IndexedDB write aborted: ${String(tx.error)}`));
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Adapter

export interface LocalStoreOptions {
  /** UUID generator for new lineages (default crypto.randomUUID). */
  newId?: () => string;
  /** Clock for version createdAt (default new Date()). */
  now?: () => Date;
}

export interface LocalRulingsStore extends RulingsStore {
  readonly kind: 'local';
  readonly persistence: Persistence;
}

function parseDocument(text: string | null): StoreDocument {
  if (text === null) return { version: 1, versions: [], rulings: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new StorageError('backend-failure', 'stored rulings are not valid JSON; refusing to overwrite them');
  }
  const d = doc as Partial<StoreDocument> | null;
  if (!d || d.version !== 1 || !Array.isArray(d.versions) || !Array.isArray(d.rulings)) {
    throw new StorageError('backend-failure', 'stored rulings have an unknown format; refusing to overwrite them');
  }
  return { version: 1, versions: d.versions, rulings: d.rulings };
}

export function createLocalRulingsStore(backend: KeyValueBackend, options: LocalStoreOptions = {}): LocalRulingsStore {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  let chain: Promise<unknown> = Promise.resolve();

  /** Run operations one at a time on this instance (read-modify-write must not interleave). */
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = chain.then(op, op);
    chain = next.catch(() => undefined);
    return next;
  };
  const load = async (): Promise<StoreDocument> => parseDocument(await backend.get(STORE_KEY));
  const save = (doc: StoreDocument): Promise<void> => backend.set(STORE_KEY, JSON.stringify(doc));

  return {
    kind: 'local',
    persistence: backend.persistence,

    append(ruling) {
      return serial(async () => {
        const problems = rulingProblems(ruling);
        if (problems.length > 0) throw new StorageError('invalid-ruling', `invalid ruling: ${problems.join('; ')}`);
        const doc = await load();
        if (doc.rulings.some((r) => r.eventId === ruling.eventId)) return; // idempotent
        const version = doc.versions.find((v) => v.sha256 === ruling.workbookSha256);
        if (!version) throw new StorageError('version-not-registered', 'the ruled workbook version is not registered');
        if (version.lineageId !== ruling.lineageId) {
          throw new StorageError('lineage-mismatch', "the ruling's lineage differs from its workbook version's lineage");
        }
        const copy: Ruling = { ...ruling };
        doc.rulings.push(copy);
        await save(doc);
      });
    },

    listByWorkbook(sha256) {
      return serial(async () => (await load()).rulings.filter((r) => r.workbookSha256 === sha256).map((r) => ({ ...r })));
    },

    listByLineage(lineageId) {
      return serial(async () => (await load()).rulings.filter((r) => r.lineageId === lineageId).map((r) => ({ ...r })));
    },

    registerVersion(input: RegisterVersionInput) {
      return serial(async () => {
        if (!SHA256_HEX_RE.test(input.sha256)) throw new StorageError('invalid-version', 'sha256 is not lower-case hex SHA-256');
        if (typeof input.displayName !== 'string' || input.displayName.length > MAX_DISPLAY_NAME) {
          throw new StorageError('invalid-version', `displayName must be text of at most ${MAX_DISPLAY_NAME} characters`);
        }
        if (input.linkedFrom !== undefined && input.linkedFrom === input.sha256) {
          throw new StorageError('invalid-version', 'a version cannot be linked to itself');
        }
        const doc = await load();
        const existing = doc.versions.find((v) => v.sha256 === input.sha256);
        if (existing) return { ...existing }; // lineage is final
        let lineageId: string;
        if (input.linkedFrom !== undefined) {
          const target = doc.versions.find((v) => v.sha256 === input.linkedFrom);
          if (!target) throw new StorageError('link-target-missing', 'the version to link from is not registered');
          lineageId = target.lineageId;
        } else {
          lineageId = newId();
        }
        const version: WorkbookVersion = {
          sha256: input.sha256,
          displayName: input.displayName,
          lineageId,
          createdAt: now().toISOString(),
        };
        if (input.linkedFrom !== undefined) version.linkedFromSha256 = input.linkedFrom;
        doc.versions.push(version);
        await save(doc);
        return { ...version };
      });
    },

    listVersions() {
      return serial(async () => (await load()).versions.map((v) => ({ ...v })));
    },
  };
}

/** Probe a Web Storage object (private modes may throw on access or on write). */
function usableLocalStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${STORE_KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * The best local store this browser offers: IndexedDB, else localStorage, else memory.
 * Never throws; `persistence` tells the UI what it got.
 */
export async function openLocalRulingsStore(options: LocalStoreOptions = {}): Promise<LocalRulingsStore> {
  try {
    const factory = globalThis.indexedDB;
    if (factory) {
      const backend = indexedDbBackend(factory);
      await backend.get(STORE_KEY); // proves the database opens
      return createLocalRulingsStore(backend, options);
    }
  } catch {
    // fall through to localStorage
  }
  const ls = usableLocalStorage();
  if (ls) return createLocalRulingsStore(localStorageBackend(ls), options);
  return createLocalRulingsStore(memoryBackend(), options);
}

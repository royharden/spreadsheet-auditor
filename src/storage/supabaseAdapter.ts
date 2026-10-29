import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_DISPLAY_NAME, SHA256_HEX_RE, UUID_RE, rulingProblems, type Decision, type Ruling, type WorkbookVersion } from '../core/rulings/types.ts';
import { indexedDbBackend, localStorageBackend, memoryBackend, type KeyValueBackend, type LocalStoreOptions, type Persistence } from './localAdapter.ts';
import { StorageError, type RegisterVersionInput, type RulingsStore } from './types.ts';

export interface CloudVersionInsert { user_id: string; workbook_sha256: string; lineage_id: string; linked_from_sha256: string | null; display_name: string; created_at: string }
export interface CloudVersionRow extends CloudVersionInsert { insertion_order: number | string }
export interface CloudRulingInsert {
  user_id: string; event_id: string; workbook_sha256: string; lineage_id: string; rule_id: Ruling['ruleId'];
  sheet: string; cell: string; formula_hash: string; decision: Decision; has_note: boolean; created_at: string;
}
export interface CloudRulingRow extends CloudRulingInsert { insertion_order: number | string }
/** Metadata-only port. Its fake tests do not establish deployed database/RLS behavior. */
export interface CloudBackend {
  findVersion(sha: string): Promise<CloudVersionRow | null>;
  insertVersion(row: CloudVersionInsert): Promise<CloudVersionRow>;
  versions(): Promise<CloudVersionRow[]>;
  findEvent(id: string): Promise<CloudRulingRow | null>;
  insertRuling(row: CloudRulingInsert): Promise<void>;
  rulings(filter: { workbookSha256?: string; lineageId?: string }): Promise<CloudRulingRow[]>;
}
export class CloudConflict extends Error { constructor() { super('Cloud unique-key conflict.'); this.name = 'CloudConflict'; } }
export interface CloudRulingsStore extends RulingsStore { readonly kind: 'cloud'; readonly notePersistence: Persistence }
const VERSION_COLUMNS = 'user_id,workbook_sha256,lineage_id,linked_from_sha256,display_name,created_at,insertion_order';
const RULING_COLUMNS = 'user_id,event_id,workbook_sha256,lineage_id,rule_id,sheet,cell,formula_hash,decision,has_note,created_at,insertion_order';

function backendError(error: { code?: string }): never {
  if (error.code === '23505') throw new CloudConflict();
  throw new StorageError('backend-failure', 'Cloud metadata request failed.');
}
function metadataBackend(client: SupabaseClient, userId: string): CloudBackend {
  return {
    async findVersion(sha) {
      const { data, error } = await client.from('workbook_versions').select(VERSION_COLUMNS).eq('user_id', userId).eq('workbook_sha256', sha).maybeSingle();
      if (error) backendError(error);
      return data as unknown as CloudVersionRow | null;
    },
    async insertVersion(row) {
      const { data, error } = await client.from('workbook_versions').insert(row).select(VERSION_COLUMNS).single();
      if (error) backendError(error);
      if (!data) throw new StorageError('backend-failure', 'Cloud version insert returned no row.');
      return data as unknown as CloudVersionRow;
    },
    async versions() {
      const { data, error } = await client.from('workbook_versions').select(VERSION_COLUMNS).eq('user_id', userId).order('insertion_order');
      if (error) backendError(error);
      return (data ?? []) as unknown as CloudVersionRow[];
    },
    async findEvent(id) {
      const { data, error } = await client.from('rulings').select(RULING_COLUMNS).eq('user_id', userId).eq('event_id', id).maybeSingle();
      if (error) backendError(error);
      return data as unknown as CloudRulingRow | null;
    },
    async insertRuling(row) {
      const { error } = await client.from('rulings').insert(row);
      if (error) backendError(error);
    },
    async rulings(filter) {
      let query = client.from('rulings').select(RULING_COLUMNS).eq('user_id', userId);
      if (filter.workbookSha256 !== undefined) query = query.eq('workbook_sha256', filter.workbookSha256);
      if (filter.lineageId !== undefined) query = query.eq('lineage_id', filter.lineageId);
      const { data, error } = await query.order('insertion_order');
      if (error) backendError(error);
      return (data ?? []) as unknown as CloudRulingRow[];
    },
  };
}

export function noteKey(userId: string, eventId: string): string { return `spreadsheet-auditor.cloud-notes.v1:${userId}:${eventId}`; }
function versionFromRow(row: CloudVersionRow, userId: string): WorkbookVersion {
  if (row.user_id !== userId || !SHA256_HEX_RE.test(row.workbook_sha256) || !UUID_RE.test(row.lineage_id) || Number.isNaN(Date.parse(row.created_at))) throw new StorageError('backend-failure', 'Invalid cloud version metadata.');
  return { sha256: row.workbook_sha256, lineageId: row.lineage_id, displayName: row.display_name, createdAt: new Date(row.created_at).toISOString(), ...(row.linked_from_sha256 === null ? {} : { linkedFromSha256: row.linked_from_sha256 }) };
}

export function createCloudRulingsStore(backend: CloudBackend, userId: string, notes: KeyValueBackend, options: LocalStoreOptions = {}): CloudRulingsStore {
  if (!UUID_RE.test(userId)) throw new StorageError('backend-failure', 'A signed-in user id is required for cloud storage.');
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = chain.then(work, work); chain = next.catch(() => undefined); return next; };
  const rulingFromRow = async (row: CloudRulingRow): Promise<Ruling> => {
    if (row.user_id !== userId || typeof row.has_note !== 'boolean') throw new StorageError('backend-failure', 'Invalid cloud ruling ownership.');
    const rawNote = await notes.get(noteKey(userId, row.event_id));
    let note: string | undefined;
    if (rawNote !== null) {
      try { const parsed = JSON.parse(rawNote) as { note?: unknown }; if (typeof parsed.note !== 'string') throw new Error(); note = parsed.note; }
      catch { throw new StorageError('backend-failure', 'Stored device note is invalid.'); }
    }
    const ruling: Ruling = { eventId: row.event_id, lineageId: row.lineage_id, workbookSha256: row.workbook_sha256, ruleId: row.rule_id, sheet: row.sheet, cell: row.cell, formulaHash: row.formula_hash, decision: row.decision, createdAt: new Date(row.created_at).toISOString(), noteLocalOnly: true,
      ...(note === undefined ? (row.has_note ? { hasNote: true } : {}) : { note }) };
    if (rulingProblems(ruling).length) throw new StorageError('backend-failure', 'Invalid cloud ruling metadata.');
    return ruling;
  };
  return {
    kind: 'cloud', notePersistence: notes.persistence,
    append(ruling) {
      return serial(async () => {
        if (rulingProblems(ruling).length) throw new StorageError('invalid-ruling', 'Invalid ruling.');
        if (await backend.findEvent(ruling.eventId)) return;
        const version = await backend.findVersion(ruling.workbookSha256);
        if (!version) throw new StorageError('version-not-registered', 'Register the workbook before ruling.');
        if (version.user_id !== userId || version.lineage_id !== ruling.lineageId) throw new StorageError('lineage-mismatch', 'Ruling lineage does not match its registered version.');
        // Explicit whitelist: note text, values, formulas and evidence never enter this payload.
        const row: CloudRulingInsert = { user_id: userId, event_id: ruling.eventId, workbook_sha256: ruling.workbookSha256, lineage_id: ruling.lineageId, rule_id: ruling.ruleId, sheet: ruling.sheet, cell: ruling.cell, formula_hash: ruling.formulaHash, decision: ruling.decision, has_note: ruling.note !== undefined || ruling.hasNote === true, created_at: ruling.createdAt };
        try { await backend.insertRuling(row); } catch (error) {
          if (error instanceof CloudConflict && await backend.findEvent(ruling.eventId)) return;
          throw error instanceof StorageError ? error : new StorageError('backend-failure', 'Ruling could not be stored.');
        }
        if (ruling.note !== undefined) {
          try { await notes.set(noteKey(userId, ruling.eventId), JSON.stringify({ note: ruling.note })); }
          catch { throw new StorageError('backend-failure', 'Ruling metadata saved, but its device-only note could not be saved.'); }
        }
      });
    },
    listByWorkbook(sha) { return serial(async () => Promise.all((await backend.rulings({ workbookSha256: sha })).map(rulingFromRow))); },
    listByLineage(lineageId) { return serial(async () => Promise.all((await backend.rulings({ lineageId })).map(rulingFromRow))); },
    registerVersion(input: RegisterVersionInput) {
      return serial(async () => {
        if (!SHA256_HEX_RE.test(input.sha256) || typeof input.displayName !== 'string' || input.displayName.length > MAX_DISPLAY_NAME || input.linkedFrom === input.sha256) throw new StorageError('invalid-version', 'Invalid workbook version.');
        const existing = await backend.findVersion(input.sha256);
        if (existing) return versionFromRow(existing, userId);
        let lineageId = newId();
        if (input.linkedFrom !== undefined) {
          const target = await backend.findVersion(input.linkedFrom);
          if (!target || target.user_id !== userId) throw new StorageError('link-target-missing', 'The linked version is not registered for this user.');
          lineageId = target.lineage_id;
        }
        const row: CloudVersionInsert = { user_id: userId, workbook_sha256: input.sha256, lineage_id: lineageId, linked_from_sha256: input.linkedFrom ?? null, display_name: input.displayName, created_at: now().toISOString() };
        try { return versionFromRow(await backend.insertVersion(row), userId); } catch (error) {
          if (error instanceof CloudConflict) { const winner = await backend.findVersion(input.sha256); if (winner) return versionFromRow(winner, userId); }
          throw error instanceof StorageError ? error : new StorageError('backend-failure', 'Version could not be registered.');
        }
      });
    },
    listVersions() { return serial(async () => (await backend.versions()).map((row) => versionFromRow(row, userId))); },
  };
}

export function createSupabaseRulingsStore(client: SupabaseClient, userId: string, notes: KeyValueBackend, options: LocalStoreOptions = {}): CloudRulingsStore {
  return createCloudRulingsStore(metadataBackend(client, userId), userId, notes, options);
}
export async function openSupabaseRulingsStore(client: SupabaseClient, userId: string): Promise<CloudRulingsStore> {
  let notes: KeyValueBackend | undefined;
  try { if (globalThis.indexedDB) { notes = indexedDbBackend(globalThis.indexedDB); await notes.get(noteKey(userId, 'probe')); } } catch { notes = undefined; }
  if (!notes) {
    try { if (globalThis.localStorage) { notes = localStorageBackend(globalThis.localStorage); await notes.get(noteKey(userId, 'probe')); } } catch { notes = undefined; }
  }
  return createSupabaseRulingsStore(client, userId, notes ?? memoryBackend());
}

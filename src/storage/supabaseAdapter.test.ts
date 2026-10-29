import { describe, expect, it } from 'vitest';
import { runRulingsStoreContract, sampleRuling, SHA_A, SHA_B } from './contract.test-helpers.ts';
import { memoryBackend, type KeyValueBackend } from './localAdapter.ts';
import { CloudConflict, createCloudRulingsStore, noteKey, type CloudBackend, type CloudRulingRow, type CloudVersionRow } from './supabaseAdapter.ts';

const USER = '11111111-1111-4111-8111-111111111111';
let sequence = 0;
const options = { now: () => new Date('2026-10-24T12:00:00.000Z'), newId: () => `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}` };

function fakeBackend() {
  const versions: CloudVersionRow[] = [];
  const rulings: CloudRulingRow[] = [];
  let next = 0;
  const backend: CloudBackend = {
    async findVersion(sha) { return versions.find((row) => row.workbook_sha256 === sha) ?? null; },
    async insertVersion(row) {
      if (versions.some((existing) => existing.workbook_sha256 === row.workbook_sha256)) throw new CloudConflict();
      const stored = { ...row, insertion_order: ++next }; versions.push(stored); return stored;
    },
    async versions() { return [...versions]; },
    async findEvent(id) { return rulings.find((row) => row.event_id === id) ?? null; },
    async insertRuling(row) {
      if (rulings.some((existing) => existing.event_id === row.event_id)) throw new CloudConflict();
      rulings.push({ ...row, insertion_order: ++next });
    },
    async rulings(filter) { return rulings.filter((row) => (filter.workbookSha256 === undefined || filter.workbookSha256 === row.workbook_sha256) && (filter.lineageId === undefined || filter.lineageId === row.lineage_id)); },
  };
  return { backend, versions, rulings };
}

runRulingsStoreContract('cloud adapter over a metadata-only fake (not deployed RLS)', () => createCloudRulingsStore(fakeBackend().backend, USER, memoryBackend(), options));

describe('cloud notes and immutable metadata', () => {
  it('never sends note text/formulas/values and restores note text only from the same device/user key', async () => {
    const remote = fakeBackend();
    const notes = memoryBackend();
    const store = createCloudRulingsStore(remote.backend, USER, notes, options);
    const version = await store.registerVersion({ sha256: SHA_A, displayName: 'budget.xlsx' });
    const ruling = sampleRuling(SHA_A, version.lineageId, { note: 'Private rationale <not a server field>' });
    await store.append(ruling);
    expect(remote.rulings[0].has_note).toBe(true);
    expect(remote.rulings[0]).not.toHaveProperty('note');
    expect(remote.rulings[0]).not.toHaveProperty('formula');
    expect(remote.rulings[0]).not.toHaveProperty('value');
    expect(JSON.stringify(remote.rulings)).not.toContain(ruling.note!);
    expect((await store.listByWorkbook(SHA_A))[0]).toEqual(ruling);
    const sameDevice = createCloudRulingsStore(remote.backend, USER, notes, options);
    expect((await sameDevice.listByWorkbook(SHA_A))[0].note).toBe(ruling.note);
    const otherDevice = createCloudRulingsStore(remote.backend, USER, memoryBackend(), options);
    expect((await otherDevice.listByWorkbook(SHA_A))[0]).toMatchObject({ hasNote: true, noteLocalOnly: true });
    expect((await otherDevice.listByWorkbook(SHA_A))[0].note).toBeUndefined();
    expect(noteKey(USER, ruling.eventId)).not.toBe(noteKey('33333333-3333-4333-8333-333333333333', ruling.eventId));
  });
  it('keeps the first device note on duplicate event writes and reports partial note persistence honestly', async () => {
    const remote = fakeBackend();
    const store = createCloudRulingsStore(remote.backend, USER, memoryBackend(), options);
    const version = await store.registerVersion({ sha256: SHA_A, displayName: 'a' });
    const ruling = sampleRuling(SHA_A, version.lineageId, { note: 'first' });
    await store.append(ruling);
    await store.append({ ...ruling, note: 'changed', decision: 'dismiss' });
    expect((await store.listByWorkbook(SHA_A))[0]).toMatchObject({ note: 'first', decision: 'confirm' });
    const blocked: KeyValueBackend = { persistence: 'memory', async get() { return null; }, async set() { throw new Error('blocked'); } };
    const failing = createCloudRulingsStore(remote.backend, USER, blocked, options);
    const other = sampleRuling(SHA_A, version.lineageId, { note: 'not saved on device' });
    await expect(failing.append(other)).rejects.toMatchObject({ code: 'backend-failure', message: expect.stringContaining('metadata saved') });
    expect((await failing.listByWorkbook(SHA_A)).find((row) => row.eventId === other.eventId)).toMatchObject({ hasNote: true });
  });
  it('resolves registration races to one immutable lineage and refuses another owner as a link target', async () => {
    const remote = fakeBackend();
    const first = createCloudRulingsStore(remote.backend, USER, memoryBackend(), options);
    const second = createCloudRulingsStore(remote.backend, USER, memoryBackend(), options);
    const registered = await Promise.all([first.registerVersion({ sha256: SHA_A, displayName: 'first' }), second.registerVersion({ sha256: SHA_A, displayName: 'second' })]);
    expect(registered[0]).toEqual(registered[1]);
    expect(remote.versions).toHaveLength(1);
    remote.versions[0].user_id = '33333333-3333-4333-8333-333333333333';
    await expect(first.registerVersion({ sha256: SHA_B, displayName: 'bad link', linkedFrom: SHA_A })).rejects.toMatchObject({ code: 'link-target-missing' });
  });
});

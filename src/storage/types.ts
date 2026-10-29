// RulingsStore (PLAN §8): the one interface both the local adapter (IndexedDB / localStorage)
// and the Supabase adapter (M6) implement, pinned by the shared contract suite in
// contract.test-helpers.ts. Semantics (identical in both):
// - registerVersion: a version is registered once; re-registering returns the existing row
//   unchanged (its lineage is final). With `linkedFrom`, the target must already be registered
//   and the new version joins the target's lineage; without it, a new lineage starts.
// - append: the ruling's workbook version must be registered, in the same lineage; a repeated
//   eventId is a no-op (first write wins), never an error.
// - list*: insertion order.

import type { Ruling, WorkbookVersion } from '../core/rulings/types.ts';

export interface RegisterVersionInput {
  sha256: string;
  displayName: string;
  /** sha256 of an already-registered version this one is a new version of. */
  linkedFrom?: string;
}

export interface RulingsStore {
  /** `local`: this browser only. `cloud`: the signed-in user's database rows. */
  readonly kind: 'local' | 'cloud';
  append(ruling: Ruling): Promise<void>;
  listByWorkbook(sha256: string): Promise<Ruling[]>;
  listByLineage(lineageId: string): Promise<Ruling[]>;
  registerVersion(input: RegisterVersionInput): Promise<WorkbookVersion>;
  listVersions(): Promise<WorkbookVersion[]>;
}

export type StorageErrorCode =
  | 'invalid-ruling'
  | 'invalid-version'
  | 'version-not-registered'
  | 'lineage-mismatch'
  | 'link-target-missing'
  | 'backend-failure';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}

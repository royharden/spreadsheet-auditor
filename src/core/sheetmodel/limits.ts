// Input caps (PLAN §5). Self-contained (no imports) so it can be shared with other runtimes.

const MiB = 1024 * 1024;

/** Largest accepted file, compressed (the uploaded bytes). */
export const MAX_COMPRESSED_BYTES = 5 * MiB;
/** Largest sum of uncompressed sizes declared in the zip central directory. */
export const MAX_DECLARED_BYTES = 50 * MiB;
/** Largest number of bytes actually inflated (running total over every part read). */
export const MAX_INFLATED_BYTES = 50 * MiB;
/** Largest number of zip entries (parts). */
export const MAX_PARTS = 2_000;
/** Largest number of sheets listed in workbook.xml. */
export const MAX_SHEETS = 20;
/** Largest number of formula cells, counted after shared-formula expansion. */
export const MAX_FORMULA_CELLS = 50_000;

export interface Limits {
  readonly maxCompressedBytes: number;
  readonly maxDeclaredBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxParts: number;
  readonly maxSheets: number;
  readonly maxFormulaCells: number;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
  maxDeclaredBytes: MAX_DECLARED_BYTES,
  maxInflatedBytes: MAX_INFLATED_BYTES,
  maxParts: MAX_PARTS,
  maxSheets: MAX_SHEETS,
  maxFormulaCells: MAX_FORMULA_CELLS,
});

const LIMIT_KEYS: readonly (keyof Limits)[] = [
  'maxCompressedBytes',
  'maxDeclaredBytes',
  'maxInflatedBytes',
  'maxParts',
  'maxSheets',
  'maxFormulaCells',
];

/** Merge overrides onto the defaults. Every limit must be a positive safe integer. */
export function resolveLimits(overrides?: Partial<Limits>): Limits {
  const merged: Limits = { ...DEFAULT_LIMITS, ...(overrides ?? {}) };
  for (const key of LIMIT_KEYS) {
    const v = merged[key];
    if (!Number.isSafeInteger(v) || v <= 0) {
      throw new RangeError(`limit ${key} must be a positive integer (got ${String(v)})`);
    }
  }
  return Object.freeze(merged);
}

// A1 addressing helpers and the canonical CellRef form `'Sheet'!A1`
// (sheet always quoted, embedded `'` doubled, no `$`). 1-based rows and columns.

export const MAX_ROW = 1_048_576;
export const MAX_COL = 16_384; // XFD

/** Canonical cell reference: `'Sheet'!A1`. */
export type CellRef = string;

export interface RowCol {
  row: number;
  col: number;
}

/** A1 address with anchors, as written in a formula (`$B$2`, `B$2`, ...). */
export interface A1Parts extends RowCol {
  rowAbs: boolean;
  colAbs: boolean;
}

/** Inclusive rectangle; `start` is the top-left corner, `end` the bottom-right. */
export interface Range {
  start: RowCol;
  end: RowCol;
}

export function isValidRow(row: number): boolean {
  return Number.isInteger(row) && row >= 1 && row <= MAX_ROW;
}

export function isValidCol(col: number): boolean {
  return Number.isInteger(col) && col >= 1 && col <= MAX_COL;
}

/** 1 -> A, 26 -> Z, 27 -> AA, 16384 -> XFD. Throws RangeError outside 1..16384. */
export function colToLetters(col: number): string {
  if (!isValidCol(col)) {
    throw new RangeError(`column ${col} is outside 1..${MAX_COL}`);
  }
  let n = col;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A -> 1, XFD -> 16384 (case-insensitive). Null when not 1-3 letters or beyond XFD. */
export function lettersToCol(letters: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n <= MAX_COL ? n : null;
}

/** Row/col -> `B2` (no anchors). */
export function toA1(row: number, col: number): string {
  if (!isValidRow(row)) {
    throw new RangeError(`row ${row} is outside 1..${MAX_ROW}`);
  }
  return `${colToLetters(col)}${row}`;
}

/** Format with anchors: `$B$2`, `B$2`, `$B2`, `B2`. */
export function formatA1(parts: A1Parts): string {
  return `${parts.colAbs ? '$' : ''}${colToLetters(parts.col)}${parts.rowAbs ? '$' : ''}${parts.row}`;
}

const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

/** Parse `B2`, `$B$2`, `b$2` ... Null when malformed or out of sheet bounds. */
export function parseA1(text: string): A1Parts | null {
  const m = A1_RE.exec(text);
  if (!m) return null;
  const col = lettersToCol(m[2]);
  const row = Number(m[4]);
  if (col === null || !isValidRow(row)) return null;
  return { row, col, colAbs: m[1] === '$', rowAbs: m[3] === '$' };
}

/** Quote a sheet name for a CellRef: always quoted, `'` doubled. */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** Canonical CellRef from a sheet name and row/col. */
export function toCellRef(sheet: string, row: number, col: number): CellRef {
  return `${quoteSheetName(sheet)}!${toA1(row, col)}`;
}

export interface ParsedCellRef extends A1Parts {
  /** Unquoted, unescaped sheet name; null when the reference had no sheet prefix. */
  sheet: string | null;
}

const QUALIFIED_RE = /^(?:'((?:[^']|'')+)'|([^'!:[\]\s]+))!(.+)$/;

/**
 * Parse `A1`, `$A$1`, `Sheet1!B2`, `'My ''Sheet'''!$C$3`. Returns null for anything else
 * (ranges, 3-D or external references, malformed text).
 */
export function parseCellRef(text: string): ParsedCellRef | null {
  const trimmed = text.trim();
  const q = QUALIFIED_RE.exec(trimmed);
  if (q) {
    const sheet = q[1] !== undefined ? q[1].replace(/''/g, "'") : q[2];
    const a1 = parseA1(q[3]);
    return a1 ? { ...a1, sheet } : null;
  }
  const a1 = parseA1(trimmed);
  return a1 ? { ...a1, sheet: null } : null;
}

/** Normalise any single-cell reference to canonical `'Sheet'!A1`; unqualified -> defaultSheet. */
export function canonicalCellRef(text: string, defaultSheet: string): CellRef | null {
  const p = parseCellRef(text);
  if (!p) return null;
  return toCellRef(p.sheet ?? defaultSheet, p.row, p.col);
}

/** Split a canonical CellRef back into its sheet and A1 parts. */
export function splitCellRef(ref: CellRef): { sheet: string; row: number; col: number } | null {
  const p = parseCellRef(ref);
  if (!p || p.sheet === null) return null;
  return { sheet: p.sheet, row: p.row, col: p.col };
}

/** Parse `A1:B3` (or a single `A1`) into a normalised Range. `$` anchors are ignored. */
export function parseRangeA1(text: string): Range | null {
  const parts = text.trim().split(':');
  if (parts.length === 1) {
    const a = parseA1(parts[0]);
    return a ? { start: { row: a.row, col: a.col }, end: { row: a.row, col: a.col } } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseA1(parts[0]);
  const b = parseA1(parts[1]);
  if (!a || !b) return null;
  return {
    start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
  };
}

export function formatRange(range: Range): string {
  const a = toA1(range.start.row, range.start.col);
  const b = toA1(range.end.row, range.end.col);
  return a === b ? a : `${a}:${b}`;
}

export function rangeContains(range: Range, row: number, col: number): boolean {
  return row >= range.start.row && row <= range.end.row && col >= range.start.col && col <= range.end.col;
}

export function rangeSize(range: Range): number {
  return (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1);
}

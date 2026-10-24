import type { Cell, Sheet } from '../sheetmodel/types.ts';

export type HeaderIndex = ReadonlyMap<number, readonly Cell[]>;
export function isTextCell(cell: Cell): boolean {
  return (cell.cachedType === 's' || cell.cachedType === 'str' || cell.cachedType === 'inlineStr') && typeof cell.cachedValue === 'string';
}

/** One sorted index per sheet avoids rescanning a large sparse column for every reference. */
export function headerIndex(sheet: Sheet): HeaderIndex {
  const columns = new Map<number, Cell[]>();
  for (const cell of sheet.cells.values()) if (isTextCell(cell)) {
    const column = columns.get(cell.col) ?? [];
    column.push(cell);
    columns.set(cell.col, column);
  }
  for (const column of columns.values()) column.sort((a, b) => a.row - b.row);
  return columns;
}

export function nearestHeader(index: HeaderIndex, row: number, col: number): Cell | undefined {
  const column = index.get(col);
  if (!column) return undefined;
  let lo = 0;
  let hi = column.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (column[mid].row < row) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? column[lo - 1] : undefined;
}

export type UnitToken = '$M' | '$000' | '$' | '%' | 'units' | 'hours';
const UNIT_PATTERNS: readonly [UnitToken, RegExp][] = [
  ['$M', /\$M\b/gi], ['$000', /\$000\b|\$K\b|\(000s\)/gi], ['$', /\$/g],
  ['%', /%/g], ['units', /\bunits\b/gi], ['hours', /\b(?:hrs|hours)\b/gi],
];

/** Longest overlapping match wins; distinct units anywhere in the same header abstain. */
export function unitOfHeader(text: string): UnitToken | null {
  const candidates: { unit: UnitToken; start: number; end: number }[] = [];
  for (const [unit, pattern] of UNIT_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      candidates.push({ unit, start: match.index, end: match.index + match[0].length });
    }
  }
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const selected: typeof candidates = [];
  for (const candidate of candidates) if (!selected.some((s) => candidate.start < s.end && s.start < candidate.end)) selected.push(candidate);
  const distinct = new Set(selected.map((s) => s.unit));
  return distinct.size === 1 ? [...distinct][0] : null;
}

// Shared-formula expansion and array-formula membership (PLAN §5).
// A shared child's text is the master's text re-based by the child's offset from the master,
// via token shift (r1c1.ts rebaseFormula), with bounds checks (out-of-sheet -> #REF!).

import { rangeContains, rangeSize, toA1, type Range } from '../util/addr.ts';
import { rebaseFormula, type RebaseResult } from './r1c1.ts';
import type { Cell } from './types.ts';

export interface SharedFormulaMaster {
  readonly row: number;
  readonly col: number;
  /** Master formula text (no `=`). */
  readonly formula: string;
}

/** Text of the shared formula as it applies at (row, col). */
export function expandSharedFormula(master: SharedFormulaMaster, row: number, col: number): RebaseResult {
  return rebaseFormula(master.formula, row - master.row, col - master.col);
}

/** Areas up to this size are walked cell by cell; larger ones scan the sheet's cells instead. */
const WALK_LIMIT = 4096;

/**
 * Mark every stored cell inside an array formula's range as `inArray` (the anchor too) and give
 * members a pointer to the anchor. Returns how many cells were marked.
 */
export function markArrayMembers(cells: Map<string, Cell>, anchor: Cell, range: Range): number {
  let marked = 0;
  const mark = (cell: Cell): void => {
    cell.inArray = true;
    if (cell !== anchor) cell.arrayAnchor = anchor.addr;
    marked++;
  };
  if (rangeSize(range) <= WALK_LIMIT) {
    for (let r = range.start.row; r <= range.end.row; r++) {
      for (let c = range.start.col; c <= range.end.col; c++) {
        const cell = cells.get(toA1(r, c));
        if (cell) mark(cell);
      }
    }
  } else {
    for (const cell of cells.values()) {
      if (rangeContains(range, cell.row, cell.col)) mark(cell);
    }
  }
  return marked;
}

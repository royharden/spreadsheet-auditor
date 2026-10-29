// Shared copied-formula neighbourhood checks. Column first is the specified tie-break.
import type { Axis } from '../evidence/bundle.ts';
import { cellAt, isMergedNonAnchor } from '../sheetmodel/model.ts';
import type { Cell, Sheet } from '../sheetmodel/types.ts';

export type PatternCell = Cell & { formula: string; r1c1: string };
export interface PatternMatch { axis: Axis; before: PatternCell; after: PatternCell }

export function isPatternCell(sheet: Sheet, cell: Cell | undefined): cell is PatternCell {
  return cell !== undefined && cell.formula !== undefined && cell.r1c1 !== undefined &&
    !cell.inArray && !cell.opaque?.length && !isMergedNonAnchor(sheet, cell.row, cell.col);
}

export function matchingNeighbours(sheet: Sheet, cell: Cell): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const axis of ['column', 'row'] as const) {
    const dr = axis === 'column' ? 1 : 0;
    const dc = axis === 'row' ? 1 : 0;
    const before = cellAt(sheet, cell.row - dr, cell.col - dc);
    const after = cellAt(sheet, cell.row + dr, cell.col + dc);
    if (isPatternCell(sheet, before) && isPatternCell(sheet, after) && before.r1c1 === after.r1c1) {
      matches.push({ axis, before, after });
    }
  }
  return matches;
}

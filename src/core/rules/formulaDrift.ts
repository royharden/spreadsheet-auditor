import { rebasedFormulaFix } from '../fix/suggest.ts';
import type { WorkbookModel } from '../sheetmodel/types.ts';
import { toCellRef } from '../util/addr.ts';
import { newFinding } from './finding.ts';
import { isPatternCell, matchingNeighbours } from './patterns.ts';
import type { Facts, Finding, RuleContext } from './types.ts';

/** A formula differs from identical immediate neighbours on either axis (PLAN §6). */
export function applyFormulaDrift(model: WorkbookModel, ctx: RuleContext): Finding[] {
  const found: Finding[] = [];
  for (const sheet of model.sheets) for (const cell of sheet.cells.values()) {
    if (!isPatternCell(sheet, cell)) continue;
    const matches = matchingNeighbours(sheet, cell).filter((m) => m.before.r1c1 !== cell.r1c1);
    const match = matches[0]; // column precedes row; exactly one finding per cell
    if (!match) continue;
    const fix = rebasedFormulaFix(match.before, cell);
    if (!fix) { ctx.note(`FORMULA_DRIFT: ${toCellRef(sheet.name, cell.row, cell.col)} skipped because its pattern rebases outside the sheet.`); continue; }
    const before = toCellRef(sheet.name, match.before.row, match.before.col);
    const after = toCellRef(sheet.name, match.after.row, match.after.col);
    const facts: Facts = { axis: match.axis, neighbour_pattern_cell: before, neighbour_before: before, neighbour_after: after };
    const rowMatch = matches.find((m) => m.axis === 'row');
    if (match.axis === 'column' && rowMatch) facts.also_row_neighbour = toCellRef(sheet.name, rowMatch.before.row, rowMatch.before.col);
    found.push(newFinding({ ruleId: 'FORMULA_DRIFT', sheet: sheet.name, cell, facts, fix, message: 'Formula differs from the matching pattern on both sides.' }));
  }
  return found;
}

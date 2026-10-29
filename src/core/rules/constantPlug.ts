import { rebasedFormulaFix } from '../fix/suggest.ts';
import { isFormulaCell, isMergedNonAnchor } from '../sheetmodel/model.ts';
import type { WorkbookModel } from '../sheetmodel/types.ts';
import { toCellRef } from '../util/addr.ts';
import { newFinding } from './finding.ts';
import { matchingNeighbours } from './patterns.ts';
import type { Finding, RuleContext } from './types.ts';

/** Numeric constant inside a copied formula run; date/array/spill members abstain. */
export function applyConstantPlug(model: WorkbookModel, ctx: RuleContext): Finding[] {
  const found: Finding[] = [];
  for (const sheet of model.sheets) for (const cell of sheet.cells.values()) {
    if (isFormulaCell(cell) || cell.cachedType !== 'n' || typeof cell.cachedValue !== 'number' ||
      cell.inArray || cell.isDateFmt || isMergedNonAnchor(sheet, cell.row, cell.col)) continue;
    const match = matchingNeighbours(sheet, cell)[0];
    if (!match) continue;
    const fix = rebasedFormulaFix(match.before, cell);
    if (!fix) { ctx.note(`CONSTANT_PLUG: ${toCellRef(sheet.name, cell.row, cell.col)} skipped because its pattern rebases outside the sheet.`); continue; }
    const before = toCellRef(sheet.name, match.before.row, match.before.col);
    const after = toCellRef(sheet.name, match.after.row, match.after.col);
    found.push(newFinding({ ruleId: 'CONSTANT_PLUG', sheet: sheet.name, cell,
      facts: { axis: match.axis, neighbour_pattern_cell: before, neighbour_before: before, neighbour_after: after }, fix,
      message: 'Numeric constant interrupts a matching formula pattern.' }));
  }
  return found;
}

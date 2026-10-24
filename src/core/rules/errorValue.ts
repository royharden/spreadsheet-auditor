// ERROR_VALUE (PLAN §6), Confirmed/high: every cell whose cached value is one of the listed
// errors. No suppression: propagated dependents are reported too, and grouped for display under
// a direct precedent that is itself a listed error (resolved from formula tokens; single-cell
// references only, same-sheet or cross-sheet).

import { errorValueFix } from '../fix/suggest.ts';
import { cellAt, findSheet } from '../sheetmodel/model.ts';
import { tokenize } from '../sheetmodel/tokenizer.ts';
import type { Cell, Sheet, WorkbookModel } from '../sheetmodel/types.ts';
import { toCellRef } from '../util/addr.ts';
import { findingId, newFinding } from './finding.ts';
import type { Facts, Finding, RuleContext } from './types.ts';

/** The errors this rule reports (other cached errors are counted in a coverage note). */
export const LISTED_ERRORS = ['#REF!', '#DIV/0!', '#N/A', '#VALUE!', '#NAME?'] as const;
export type ListedError = (typeof LISTED_ERRORS)[number];

export function listedError(value: unknown): ListedError | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return (LISTED_ERRORS as readonly string[]).includes(v) ? (v as ListedError) : null;
}

function isListedErrorCell(cell: Cell | undefined): cell is Cell {
  return cell !== undefined && cell.cachedType === 'e' && listedError(cell.cachedValue) !== null;
}

export interface ErrorPrecedent {
  sheet: Sheet;
  cell: Cell;
  error: ListedError;
}

/** First single-cell reference (token order) whose cell holds a listed cached error. */
export function errorPrecedent(model: WorkbookModel, sheet: Sheet, cell: Cell): ErrorPrecedent | null {
  if (cell.formula === undefined) return null;
  for (const t of tokenize(cell.formula)) {
    if (t.kind !== 'ref') continue;
    const target = t.sheet === undefined ? sheet : findSheet(model, t.sheet);
    if (!target) continue;
    const c = cellAt(target, t.cell.row, t.cell.col);
    if (c === cell || !isListedErrorCell(c)) continue;
    const error = listedError(c.cachedValue);
    if (error) return { sheet: target, cell: c, error };
  }
  return null;
}

export function applyErrorValue(model: WorkbookModel, ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  let unlisted = 0;
  for (const sheet of model.sheets) {
    for (const cell of sheet.cells.values()) {
      if (cell.cachedType !== 'e') continue;
      const error = listedError(cell.cachedValue);
      if (!error) {
        unlisted++;
        continue;
      }
      const hasFormula = cell.formulaKind !== undefined;
      const precedent = errorPrecedent(model, sheet, cell);
      const facts: Facts = { error_value: error, has_formula: hasFormula };
      let displayGroup: string | undefined;
      let precedentText: string | undefined;
      if (precedent) {
        const ref = toCellRef(precedent.sheet.name, precedent.cell.row, precedent.cell.col);
        facts.precedent_cell = ref;
        facts.precedent_error = precedent.error;
        displayGroup = findingId('ERROR_VALUE', precedent.sheet.name, precedent.cell.addr);
        precedentText = precedent.sheet === sheet ? precedent.cell.addr : ref;
      }
      const finding = newFinding({
        ruleId: 'ERROR_VALUE',
        sheet: sheet.name,
        cell,
        message: precedentText !== undefined ? `Cached ${error} (propagated from ${precedentText})` : `Cached ${error}`,
        facts,
        fix: errorValueFix({ cell: cell.addr, errorValue: error, hasFormula, precedentCell: precedentText }),
        displayGroup,
      });
      out.push(finding);
    }
  }
  if (unlisted > 0) {
    ctx.note(
      `ERROR_VALUE: ${unlisted} cell(s) hold cached errors outside the reported set (${LISTED_ERRORS.join(', ')}), e.g. #NUM! or #SPILL!; they are not reported.`,
    );
  }
  return out;
}

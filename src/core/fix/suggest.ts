// Code-generated suggested fixes (PLAN §6). A fix is never produced by a model.
// - text kinds (M2): ERROR_VALUE, BROKEN_REF; MIXED_UNITS (M3) also uses text.
// - formula kinds (M3): FORMULA_DRIFT / CONSTANT_PLUG re-base a neighbour's formula to the
//   flagged cell by token shift (`rebasedFormulaFix`, implemented here so M3 only wires it);
//   SUM_RANGE_SHORT extends the range (`sumRangeFix`).

import { rebaseFormula } from '../sheetmodel/r1c1.ts';
import type { Fix } from '../rules/types.ts';
import { toA1 } from '../util/addr.ts';

/** Why each listed cached error usually happens (plain advice, no workbook content). */
const ERROR_CAUSE: Readonly<Record<string, string>> = {
  '#DIV/0!': 'a divisor is zero or blank',
  '#N/A': 'a lookup found no match, or a value is marked not available',
  '#VALUE!': 'an argument has the wrong type, often text where a number is expected',
  '#NAME?': 'a function or defined name is misspelled or missing',
  '#REF!': 'a referenced cell, row, column or sheet was deleted',
};

export function errorCause(errorValue: string): string {
  return ERROR_CAUSE[errorValue] ?? 'Excel could not compute the value';
}

/** ERROR_VALUE: fix the root; a propagated error clears once its source is fixed. */
export function errorValueFix(input: { cell: string; errorValue: string; hasFormula: boolean; precedentCell?: string }): Fix {
  if (!input.hasFormula) {
    return {
      kind: 'text',
      value: `${input.cell} holds ${input.errorValue} as a typed value, not a formula result; replace it with the intended value or formula.`,
    };
  }
  if (input.precedentCell !== undefined) {
    return {
      kind: 'text',
      value: `Fix the error in ${input.precedentCell} first; ${input.cell} shows ${input.errorValue} because it depends on that cell and will recalculate once the source is corrected.`,
    };
  }
  return {
    kind: 'text',
    value: `Correct the cause in ${input.cell} (${input.errorValue}: ${errorCause(input.errorValue)}). Wrap the formula in IFERROR only if the error is expected and a fallback value is correct.`,
  };
}

/** BROKEN_REF: the original target is gone; only the author can say what it was. */
export function brokenRefFix(input: { cell: string; count: number }): Fix {
  const each = input.count > 1 ? `each of the ${input.count} #REF! parts` : 'the #REF! part';
  return {
    kind: 'text',
    value: `Rewrite the formula in ${input.cell}, replacing ${each} with the intended reference. The cell, row, column or sheet it pointed to was deleted, so Excel cannot restore it.`,
  };
}

/**
 * Formula fix built from a neighbour's formula re-based to the flagged cell by token shift
 * (FORMULA_DRIFT, CONSTANT_PLUG). Returns null when re-basing pushes a reference off the sheet.
 */
export function rebasedFormulaFix(
  source: { formula: string; row: number; col: number },
  target: { row: number; col: number },
): Fix | null {
  const r = rebaseFormula(source.formula, target.row - source.row, target.col - source.col);
  if (r.outOfBounds) return null;
  const text = r.formula.startsWith('=') ? r.formula : `=${r.formula}`;
  return { kind: 'formula', value: text };
}

/** SUM_RANGE_SHORT: `=SUM(start:continuation)` over the same row or column. */
export function sumRangeFix(start: { row: number; col: number }, end: { row: number; col: number }): Fix {
  return { kind: 'formula', value: `=SUM(${toA1(start.row, start.col)}:${toA1(end.row, end.col)})` };
}

/** Plain advice fix (MIXED_UNITS and any rule without a mechanical repair). */
export function textFix(value: string): Fix {
  return { kind: 'text', value };
}

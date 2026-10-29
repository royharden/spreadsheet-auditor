import type { RuleId } from '../src/core/rules/types.ts';
import { formulaCell, numberCell, textCell, type Plant, type SourceSheet } from './cellmodel.ts';
import type { Random } from './prng.ts';

function primary(cell: string, rule: RuleId, caseName: string, also: RuleId[] = []): Plant {
  return { cell, primaryRule: rule, truth: 'defect', role: 'primary', denominatorEligible: true, also_ok_rules: also, caseName };
}

export function injectErrorValue(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  const row = 32 + offset;
  sheet.cells[`A${row}`] = numberCell(random.int(1, 10));
  sheet.cells[`B${row}`] = formulaCell(`A${row}/0`, '#DIV/0!', true);
  sheet.cells[`B${row + 1}`] = formulaCell(`B${row}*2`, '#DIV/0!', true);
  sheet.cells[`B${row + 3}`] = textCell('#DIV/0!');
  return [
    primary(`B${row}`, 'ERROR_VALUE', 'divide-by-zero-root'),
    { cell: `B${row + 1}`, primaryRule: null, truth: 'neutral', role: 'propagated', denominatorEligible: false, also_ok_rules: ['ERROR_VALUE'], caseName: 'propagated-division-error' },
    { cell: `B${row + 3}`, primaryRule: null, truth: 'neutral', role: 'clean', denominatorEligible: false, also_ok_rules: [], caseName: 'error-looking-text' },
  ];
}

export function injectBrokenRef(sheet: SourceSheet, _random: Random, offset = 0): Plant[] {
  const addr = `B${37 + offset}`;
  sheet.cells[addr] = formulaCell('#REF!+1', '#REF!', true);
  // One denominator row, with the independent cached-error detector counted as neutral overlap.
  return [primary(addr, 'BROKEN_REF', 'broken-reference-and-error-cache', ['ERROR_VALUE'])];
}

export function injectFormulaDrift(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  const center = 44 + offset;
  for (let row = center - 2; row <= center + 2; row++) {
    const left = random.int(10, 50);
    const right = random.int(2, 8);
    sheet.cells[`B${row}`] = numberCell(left);
    sheet.cells[`C${row}`] = numberCell(right);
    sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}`, left * right);
    // The scalar keeps this a drift case without introducing a second units-addition defect.
    if (row === center) sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}+1`, left * right + 1);
  }
  const row = 49 + offset;
  for (const col of ['D', 'E', 'F']) {
    const input = random.int(2, 20);
    sheet.cells[`${col}${row - 1}`] = numberCell(input);
    sheet.cells[`${col}${row}`] = formulaCell(`${col}${row - 1}*2`, input * 2);
    if (col === 'E') sheet.cells[`${col}${row}`] = formulaCell(`${col}${row - 1}+2`, input + 2);
  }
  return [primary(`D${center}`, 'FORMULA_DRIFT', 'copy-down-drift'), primary(`E${row}`, 'FORMULA_DRIFT', 'copy-across-drift')];
}

export function injectConstantPlug(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  const center = 44 + offset;
  for (let row = center - 2; row <= center + 2; row++) {
    const value = random.int(5, 20);
    sheet.cells[`F${row}`] = numberCell(value);
    sheet.cells[`G${row}`] = formulaCell(`F${row}*2`, value * 2);
  }
  sheet.cells[`G${center}`] = numberCell(random.int(60, 90));
  return [primary(`G${center}`, 'CONSTANT_PLUG', 'pasted-numeric-result')];
}

export function injectSumRangeShort(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  let cached = 0;
  for (let row = 50 + offset; row <= 56 + offset; row++) {
    const value = random.int(10, 100);
    sheet.cells[`B${row}`] = numberCell(value);
    if (row <= 54 + offset) cached += value;
  }
  const addr = `B${57 + offset}`;
  sheet.cells[addr] = formulaCell(`SUM(B${50 + offset}:B${54 + offset})`, cached);
  return [primary(addr, 'SUM_RANGE_SHORT', 'omitted-final-two-rows')];
}

export function injectMixedUnits(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  sheet.cells[`J${41 + offset}`] = textCell('Rate %');
  for (let row = 42 + offset; row <= 46 + offset; row++) sheet.cells[`J${row}`] = numberCell(random.int(2, 9) / 100);
  sheet.cells[`J${44 + offset}`] = numberCell(5);
  sheet.cells[`K${61 + offset}`] = textCell('Amount $000');
  sheet.cells[`L${61 + offset}`] = textCell('Amount $');
  const thousands = random.int(5, 20);
  const dollars = random.int(100, 500);
  sheet.cells[`K${62 + offset}`] = numberCell(thousands);
  sheet.cells[`L${62 + offset}`] = numberCell(dollars);
  sheet.cells[`N${62 + offset}`] = formulaCell(`K${62 + offset}+L${62 + offset}`, thousands + dollars);
  return [primary(`J${44 + offset}`, 'MIXED_UNITS', 'percent-column-whole-among-fractions'), primary(`N${62 + offset}`, 'MIXED_UNITS', 'formula-addition-thousands-and-dollars')];
}

export const DEFECT_INJECTORS = [injectErrorValue, injectBrokenRef, injectFormulaDrift, injectConstantPlug, injectSumRangeShort, injectMixedUnits] as const;

export function injectDefects(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  return DEFECT_INJECTORS.flatMap((inject) => inject(sheet, random, offset));
}

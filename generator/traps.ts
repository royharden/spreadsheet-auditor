import type { RuleId } from '../src/core/rules/types.ts';
import { formulaCell, numberCell, textCell, type Plant, type SourceSheet } from './cellmodel.ts';
import type { Random } from './prng.ts';

function intentional(cell: string, rule: RuleId, caseName: string): Plant {
  return { cell, primaryRule: rule, truth: 'by_design', role: 'by_design', denominatorEligible: false, also_ok_rules: [], caseName };
}

function clean(cell: string, caseName: string): Plant {
  return { cell, primaryRule: null, truth: 'neutral', role: 'clean', denominatorEligible: false, also_ok_rules: [], caseName };
}

/** Deliberately suspicious valid cells are false positives unless triage sets them aside. */
export function plantNamedTraps(sheet: SourceSheet, random: Random, offset = 0): Plant[] {
  const center = 75 + offset;
  for (let row = center - 2; row <= center + 2; row++) {
    const left = random.int(2, 9);
    const right = random.int(2, 9);
    sheet.cells[`B${row}`] = numberCell(left);
    sheet.cells[`C${row}`] = numberCell(right);
    sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}`, left * right);
    if (row === center) sheet.cells[`D${row}`] = formulaCell(`SUM(B${row}:C${row})`, left + right);
    sheet.cells[`F${row}`] = numberCell(21);
    sheet.cells[`G${row}`] = formulaCell(`F${row}*0.01`, 0.21);
  }
  sheet.cells[`A${center}`] = textCell('Subtotal row (sum is intentional)');
  sheet.cells[`E${center}`] = textCell('Tax rate (fixed by design)');
  sheet.cells[`G${center}`] = numberCell(0.21);

  let included = 0;
  for (let row = 80 + offset; row <= 85 + offset; row++) {
    const value = random.int(10, 50);
    sheet.cells[`B${row}`] = numberCell(value);
    sheet.cells[`A${row}`] = textCell(row > 83 + offset ? 'Excluded contingency (by design)' : 'Included expense');
    if (row <= 83 + offset) included += value;
  }
  sheet.cells[`A${86 + offset}`] = textCell('Approved expenses, excluding contingency');
  sheet.cells[`B${86 + offset}`] = formulaCell(`SUM(B${80 + offset}:B${83 + offset})`, included);

  sheet.cells[`J${72 + offset}`] = textCell('Rate %');
  for (let row = 73 + offset; row <= 77 + offset; row++) sheet.cells[`J${row}`] = numberCell(row === center ? 5 : 0.05);
  sheet.cells[`I${center}`] = textCell('Whole-percent legacy entry (by design)');

  // Longest overlap wins: $000 + $000 is compatible, and a two-token header abstains.
  sheet.cells[`K${91 + offset}`] = textCell('Revenue $000');
  sheet.cells[`L${91 + offset}`] = textCell('Cost $000');
  sheet.cells[`K${92 + offset}`] = numberCell(12);
  sheet.cells[`L${92 + offset}`] = numberCell(4);
  sheet.cells[`N${92 + offset}`] = formulaCell(`K${92 + offset}+L${92 + offset}`, 16);
  sheet.cells[`K${100 + offset}`] = textCell('Revenue $000 units');
  sheet.cells[`L${100 + offset}`] = textCell('Cost $');
  sheet.cells[`K${101 + offset}`] = numberCell(12);
  sheet.cells[`L${101 + offset}`] = numberCell(4);
  sheet.cells[`N${101 + offset}`] = formulaCell(`K${101 + offset}+L${101 + offset}`, 16);

  for (const row of [83 + offset, 85 + offset, 93 + offset, 95 + offset]) {
    sheet.cells[`F${row}`] = numberCell(100);
    sheet.cells[`G${row}`] = formulaCell(`F${row}*2`, 200);
  }
  sheet.cells[`G${84 + offset}`] = numberCell(45000, 'date');
  sheet.cells[`G${94 + offset}`] = { ...formulaCell(`F${94 + offset}*2`, 200), arrayRef: `G${94 + offset}:H${94 + offset}` };
  sheet.cells[`F${94 + offset}`] = numberCell(100);
  for (const row of [93 + offset, 95 + offset]) {
    sheet.cells[`I${row}`] = numberCell(100);
    sheet.cells[`H${row}`] = formulaCell(`I${row}*2`, 200);
  }
  sheet.cells[`H${94 + offset}`] = numberCell(200);
  return [
    intentional(`D${center}`, 'FORMULA_DRIFT', 'subtotal-row-drift-by-design'),
    intentional(`G${center}`, 'CONSTANT_PLUG', 'labelled-fixed-tax-rate-by-design'),
    intentional(`B${86 + offset}`, 'SUM_RANGE_SHORT', 'contingency-excluded-by-design'),
    intentional(`J${center}`, 'MIXED_UNITS', 'legacy-whole-percent-by-design'),
    clean(`N${92 + offset}`, 'compatible-thousands-addition'),
    clean(`N${101 + offset}`, 'ambiguous-two-token-header-abstains'),
    clean(`G${84 + offset}`, 'date-inside-formula-run'),
    clean(`H${94 + offset}`, 'array-member-is-not-a-plug'),
  ];
}

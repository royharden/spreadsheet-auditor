import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from '../cellmodel.ts';
import type { Random } from '../prng.ts';

export function buildBudget(random: Random): WorkbookSource {
  const sheet = newSheet('Budget');
  sheet.cells.A1 = textCell('Department');
  sheet.cells.B1 = textCell('Budget $');
  sheet.cells.C1 = textCell('Actual $');
  sheet.cells.D1 = textCell('Variance $');
  let budgetTotal = 0;
  let actualTotal = 0;
  for (let row = 2; row <= 11; row++) {
    const budget = random.int(80, 250) * 100;
    const actual = budget + random.int(-10, 20) * 100;
    sheet.cells[`A${row}`] = textCell(`Department ${row - 1}`);
    sheet.cells[`B${row}`] = numberCell(budget);
    sheet.cells[`C${row}`] = numberCell(actual);
    sheet.cells[`D${row}`] = formulaCell(`C${row}-B${row}`, actual - budget);
    budgetTotal += budget;
    actualTotal += actual;
  }
  sheet.cells.A12 = textCell('Quarter total');
  sheet.cells.B12 = formulaCell('SUM(B2:B11)', budgetTotal);
  sheet.cells.C12 = formulaCell('SUM(C2:C11)', actualTotal);
  sheet.cells.D12 = formulaCell('C12-B12', actualTotal - budgetTotal);
  return { sheets: [sheet] };
}

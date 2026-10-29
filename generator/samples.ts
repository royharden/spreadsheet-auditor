import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from './cellmodel.ts';
import { writeXlsx } from './xlsxWriter.ts';

export const SAMPLE_SHEET = 'Budget';
export const SAMPLE_DRIFT_CELL = 'D6';
export const SAMPLE_TAX_RATE_CELL = 'G16';

/** Browser-safe source, separate from corpus routing. The two versions differ at D6 only. */
export function budgetQ3Source(version: 1 | 2): WorkbookSource {
  if (version !== 1 && version !== 2) throw new Error('Unknown budget sample version.');
  const sheet = newSheet(SAMPLE_SHEET);
  sheet.cells.A1 = textCell('Budget Q3');
  sheet.cells.B1 = textCell('Cost $');
  sheet.cells.C1 = textCell('Quantity units');
  sheet.cells.D1 = textCell('Extended cost $');
  let shortTotal = 0;
  for (let row = 2; row <= 11; row++) {
    const cost = 100 + row * 10;
    const quantity = 2 + (row % 3);
    sheet.cells[`A${row}`] = textCell(`Expense ${row - 1}`);
    sheet.cells[`B${row}`] = numberCell(cost);
    sheet.cells[`C${row}`] = numberCell(quantity);
    sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}`, cost * quantity);
    if (row <= 9) shortTotal += cost;
  }
  sheet.cells.A12 = textCell('Quarter total (omitted final rows)');
  sheet.cells.B12 = formulaCell('SUM(B2:B9)', shortTotal);
  const cost = 160;
  const quantity = 2;
  sheet.cells.D6 = version === 1 ? formulaCell('B6+C6', cost + quantity) : formulaCell('B6-C6', cost - quantity);

  sheet.cells.F1 = textCell('Input');
  sheet.cells.G1 = textCell('Calculated output');
  for (let row = 4; row <= 8; row++) {
    sheet.cells[`F${row}`] = numberCell(row * 10);
    sheet.cells[`G${row}`] = formulaCell(`F${row}*2`, row * 20);
  }
  sheet.cells.G6 = numberCell(135);
  for (let row = 14; row <= 18; row++) {
    sheet.cells[`F${row}`] = numberCell(21);
    sheet.cells[`G${row}`] = formulaCell(`F${row}*0.01`, 0.21);
  }
  sheet.cells.E16 = textCell('Tax rate (fixed by design)');
  sheet.cells.G16 = numberCell(0.21);
  sheet.cells.J1 = textCell('Rate %');
  for (let row = 2; row <= 6; row++) sheet.cells[`J${row}`] = numberCell(row === 4 ? 5 : 0.05);

  sheet.cells.M1 = textCell('Cached error examples');
  sheet.cells.N2 = formulaCell('1/0', '#DIV/0!', true);
  sheet.cells.N3 = formulaCell('N2*2', '#DIV/0!', true);
  sheet.cells.N4 = formulaCell('N3+1', '#DIV/0!', true);
  sheet.cells.N6 = formulaCell('#REF!+1', '#REF!', true);
  return { sheets: [sheet] };
}

/** No I/O, clock, random state or binary fixture: stable bytes support exact-hash ruling replay. */
export function buildBudgetQ3(version: 1 | 2): Uint8Array {
  return writeXlsx(budgetQ3Source(version));
}

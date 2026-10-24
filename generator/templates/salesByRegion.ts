import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from '../cellmodel.ts';
import type { Random } from '../prng.ts';

export function buildSalesByRegion(random: Random): WorkbookSource {
  const sheet = newSheet('Regional sales');
  sheet.cells.A1 = textCell('Region');
  sheet.cells.B1 = textCell('Units');
  sheet.cells.C1 = textCell('Price $');
  sheet.cells.D1 = textCell('Revenue $');
  let revenue = 0;
  for (let row = 2; row <= 9; row++) {
    const units = random.int(50, 500);
    const price = random.int(20, 80);
    sheet.cells[`A${row}`] = textCell(`Region ${row - 1}`);
    sheet.cells[`B${row}`] = numberCell(units);
    sheet.cells[`C${row}`] = numberCell(price);
    sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}`, units * price);
    revenue += units * price;
  }
  sheet.cells.A10 = textCell('Sales total');
  sheet.cells.D10 = formulaCell('SUM(D2:D9)', revenue);
  return { sheets: [sheet] };
}

import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from '../cellmodel.ts';
import type { Random } from '../prng.ts';

export function buildPayroll(random: Random): WorkbookSource {
  const sheet = newSheet('Payroll');
  sheet.cells.A1 = textCell('Employee');
  sheet.cells.B1 = textCell('Hours');
  sheet.cells.C1 = textCell('Hourly pay $');
  sheet.cells.D1 = textCell('Gross pay $');
  let gross = 0;
  for (let row = 2; row <= 13; row++) {
    const hours = random.int(20, 40);
    const hourly = random.int(18, 60);
    sheet.cells[`A${row}`] = textCell(`Synthetic employee ${row - 1}`);
    sheet.cells[`B${row}`] = numberCell(hours);
    sheet.cells[`C${row}`] = numberCell(hourly);
    sheet.cells[`D${row}`] = formulaCell(`B${row}*C${row}`, hours * hourly);
    gross += hours * hourly;
  }
  sheet.cells.A14 = textCell('Gross total');
  sheet.cells.D14 = formulaCell('SUM(D2:D13)', gross);
  return { sheets: [sheet] };
}

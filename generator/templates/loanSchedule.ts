import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from '../cellmodel.ts';
import type { Random } from '../prng.ts';

export function buildLoanSchedule(random: Random): WorkbookSource {
  const sheet = newSheet('Loan schedule');
  sheet.cells.A1 = textCell('Period');
  sheet.cells.B1 = textCell('Opening $');
  sheet.cells.C1 = textCell('Principal $');
  sheet.cells.D1 = textCell('Closing $');
  let balance = random.int(50, 100) * 1000;
  const principal = random.int(1, 3) * 1000;
  for (let row = 2; row <= 13; row++) {
    sheet.cells[`A${row}`] = numberCell(row - 1);
    sheet.cells[`B${row}`] = row === 2 ? numberCell(balance) : formulaCell(`D${row - 1}`, balance);
    sheet.cells[`C${row}`] = numberCell(principal);
    sheet.cells[`D${row}`] = formulaCell(`B${row}-C${row}`, balance - principal);
    balance -= principal;
  }
  return { sheets: [sheet] };
}

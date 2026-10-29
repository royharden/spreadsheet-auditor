import { formulaCell, newSheet, numberCell, textCell, type WorkbookSource } from '../cellmodel.ts';
import type { Random } from '../prng.ts';

export function buildInventory(random: Random): WorkbookSource {
  const sheet = newSheet('Inventory');
  sheet.cells.A1 = textCell('Stock item');
  sheet.cells.B1 = textCell('Opening units');
  sheet.cells.C1 = textCell('Received units');
  sheet.cells.D1 = textCell('Issued units');
  sheet.cells.E1 = textCell('Closing units');
  for (let row = 2; row <= 15; row++) {
    const opening = random.int(100, 500);
    const received = random.int(10, 100);
    const issued = random.int(10, 80);
    sheet.cells[`A${row}`] = textCell(`SKU-${1000 + row}`);
    sheet.cells[`B${row}`] = numberCell(opening);
    sheet.cells[`C${row}`] = numberCell(received);
    sheet.cells[`D${row}`] = numberCell(issued);
    sheet.cells[`E${row}`] = formulaCell(`B${row}+C${row}-D${row}`, opening + received - issued);
  }
  return { sheets: [sheet] };
}

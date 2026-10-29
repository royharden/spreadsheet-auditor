// Test-only rule fixtures. Templates run their checker invariant over the same fixtures.
import { buildXlsx, fml, num, row, singleSheet, stylesXml } from '../sheetmodel/testkit.ts';
import { txt, type Fixture } from '../testFixtures.ts';

export function driftColumnWorkbook(): Uint8Array {
  return singleSheet([2, 3, 4].map((r) => row(r, num(`A${r}`, r) + fml(`B${r}`, `A${r}*${r === 3 ? 3 : 2}`, r * (r === 3 ? 3 : 2)))).join(''));
}
export function driftRowWorkbook(): Uint8Array {
  return singleSheet(row(1, num('B1', 2) + num('C1', 3) + num('D1', 4)) +
    row(2, fml('B2', 'B1*2', 4) + fml('C2', 'C1*3', 9) + fml('D2', 'D1*2', 8)));
}
export function plugWorkbook(taxRate = false): Uint8Array {
  return singleSheet(row(2, num('A2', 2) + fml('B2', 'A2*2', 4)) +
    row(3, (taxRate ? txt('A3', 'Tax rate') : num('A3', 3)) + num('B3', taxRate ? 0.05 : 7)) +
    row(4, num('A4', 4) + fml('B4', 'A4*2', 8)));
}

export type Continuation = 'numeric' | 'formula' | 'missing' | 'subtotal' | 'blank' | 'text';
export function sumWorkbook(continuation: Continuation = 'numeric', end = 9): Uint8Array {
  let rows = row(1, txt('B1', 'Amount $'));
  for (let r = 2; r <= 11; r++) {
    let cell = num(`B${r}`, r);
    if (r === 10) {
      if (continuation === 'formula') cell = fml('B10', 'A10*2', 20);
      if (continuation === 'missing') cell = fml('B10', 'A10*2');
      if (continuation === 'subtotal') cell = fml('B10', 'SUBTOTAL(9,B2:B9)', 44);
      if (continuation === 'blank') cell = '';
      if (continuation === 'text') cell = txt('B10', 'Note');
    }
    rows += row(r, num(`A${r}`, r) + cell);
  }
  return singleSheet(rows + row(12, fml('B12', `SUM(B2:B${end})`, 44)));
}

export function percentWorkbook(): Uint8Array {
  return singleSheet(row(1, txt('A1', 'Rate %')) + row(2, num('A2', 0.05)) +
    row(3, fml('A3', '1/20', 0.05)) + row(4, num('A4', 5)));
}
export function additionWorkbook(left = 'Revenue $000', right = 'Cost $', formula = 'A2+B2'): Uint8Array {
  return singleSheet(row(1, txt('A1', left) + txt('B1', right)) + row(2, num('A2', 10) + num('B2', 20) + fml('C2', formula, 30)));
}
export function percentTieWorkbook(): Uint8Array {
  return singleSheet(row(1, txt('A1', 'Percent')) + row(2, num('A2', 0.05, 1)) + row(3, num('A3', 0.05)) +
    row(4, num('A4', 5)) + row(5, num('A5', 45000, 2)) + row(6, num('A6', 0)) + row(7, num('A7', -1)),
  { stylesXml: stylesXml({}, [0, 9, 14]) });
}
export function totalTrapWorkbook(): Uint8Array {
  return buildXlsx({ sheets: [{ name: 'Total trap', rows:
    row(2, txt('A2', 'Item') + fml('B2', 'C2*2', 4) + num('C2', 2)) +
    row(3, txt('A3', 'Total row (by design)') + fml('B3', 'SUM(C2:C4)', 9) + num('C3', 3)) +
    row(4, txt('A4', 'Item') + fml('B4', 'C4*2', 8) + num('C4', 4)) }] });
}

export const M3_FIXTURES: readonly Fixture[] = [
  { name: 'drift-column', fileName: 'drift-column.xlsx', build: driftColumnWorkbook },
  { name: 'drift-row', fileName: 'drift-row.xlsx', build: driftRowWorkbook },
  { name: 'plug', fileName: 'plug.xlsx', build: () => plugWorkbook() },
  { name: 'tax-rate-by-design', fileName: 'tax-rate.xlsx', build: () => plugWorkbook(true) },
  { name: 'total-row-by-design', fileName: 'total-row.xlsx', build: totalTrapWorkbook },
  { name: 'short-sum', fileName: 'short-sum.xlsx', build: () => sumWorkbook() },
  { name: 'short-sum-distant-end', fileName: 'short-sum-distant-end.xlsx', build: () => sumWorkbook('numeric', 2) },
  { name: 'numeric-formula-continuation', fileName: 'numeric-formula-continuation.xlsx', build: () => sumWorkbook('formula') },
  { name: 'mixed-percent', fileName: 'mixed-percent.xlsx', build: percentWorkbook },
  { name: 'percent-tie', fileName: 'percent-tie.xlsx', build: percentTieWorkbook },
  { name: 'mixed-addition', fileName: 'mixed-addition.xlsx', build: () => additionWorkbook() },
];

import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { fml, num, row, singleSheet } from '../sheetmodel/testkit.ts';
import { applyFormulaDrift } from './formulaDrift.ts';
import { driftColumnWorkbook, driftRowWorkbook, totalTrapWorkbook } from './m3Fixtures.ts';

const ctx = { note: (_text: string) => undefined };
describe('FORMULA_DRIFT', () => {
  it('detects column and row patterns and rebases the neighbour formula', () => {
    expect(applyFormulaDrift(readWorkbook(driftColumnWorkbook()), ctx)).toMatchObject([
      { cell: 'B3', facts: { axis: 'column', neighbour_pattern_cell: "'Sheet1'!B2" }, fix: { kind: 'formula', value: '=A3*2' } },
    ]);
    expect(applyFormulaDrift(readWorkbook(driftRowWorkbook()), ctx)).toMatchObject([
      { cell: 'C2', facts: { axis: 'row' }, fix: { kind: 'formula', value: '=C1*2' } },
    ]);
  });
  it('requires both neighbours and stays silent for a matching formula run', () => {
    const bytes = singleSheet([2, 3, 4].map((r) => row(r, num(`A${r}`, r) + fml(`B${r}`, `A${r}*2`, r * 2))).join(''));
    expect(applyFormulaDrift(readWorkbook(bytes), ctx)).toEqual([]);
    const model = readWorkbook(driftColumnWorkbook());
    model.sheets[0].cells.delete('B4');
    expect(applyFormulaDrift(model, ctx)).toEqual([]);
  });
  it('chooses column when both axes qualify and records the row neighbour', () => {
    const bytes = singleSheet(row(2, num('B2', 1) + fml('C2', 'B2*2', 2)) +
      row(3, num('A3', 1) + fml('B3', 'A3*2', 2) + fml('C3', 'B3*3', 6) + fml('D3', 'C3*2', 12)) +
      row(4, num('B4', 1) + fml('C4', 'B4*2', 2)));
    const found = applyFormulaDrift(readWorkbook(bytes), ctx).filter((f) => f.cell === 'C3');
    expect(found).toHaveLength(1);
    expect(found[0].facts).toMatchObject({ axis: 'column', also_row_neighbour: "'Sheet1'!B3" });
  });
  it('abstains on opaque, array and merged non-anchor candidates or neighbours', () => {
    for (const excluded of ['B2', 'B3', 'B4']) {
      for (const reason of ['opaque', 'array', 'merge'] as const) {
        const model = readWorkbook(driftColumnWorkbook());
        const sheet = model.sheets[0];
        const cell = sheet.cells.get(excluded)!;
        if (reason === 'opaque') cell.opaque = ['structured-ref'];
        if (reason === 'array') cell.inArray = true;
        if (reason === 'merge') sheet.merges.push({ start: { row: cell.row, col: 1 }, end: { row: cell.row, col: 2 } });
        expect(applyFormulaDrift(model, ctx)).toEqual([]);
      }
    }
  });
  it('retains the named total-row by-design trap for later human/model triage', () => {
    expect(applyFormulaDrift(readWorkbook(totalTrapWorkbook()), ctx).map((f) => f.cell)).toContain('B3');
  });
});

import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { fml, num, row, singleSheet, stylesXml } from '../sheetmodel/testkit.ts';
import { applyConstantPlug } from './constantPlug.ts';
import { plugWorkbook } from './m3Fixtures.ts';

const ctx = { note: (_text: string) => undefined };
describe('CONSTANT_PLUG', () => {
  it('finds a numeric constant between copied formulas and emits a rebased formula fix', () => {
    expect(applyConstantPlug(readWorkbook(plugWorkbook()), ctx)).toMatchObject([
      { cell: 'B3', facts: { axis: 'column' }, fix: { kind: 'formula', value: '=A3*2' } },
    ]);
    const bytes = singleSheet(row(1, num('B1', 2) + num('C1', 3) + num('D1', 4)) +
      row(2, fml('B2', 'B1*2', 4) + num('C2', 7) + fml('D2', 'D1*2', 8)));
    expect(applyConstantPlug(readWorkbook(bytes), ctx)).toMatchObject([{ cell: 'C2', facts: { axis: 'row' }, fix: { value: '=C1*2' } }]);
  });
  it('requires matching formulas on both sides (benign edges and unlike neighbours)', () => {
    const model = readWorkbook(plugWorkbook());
    model.sheets[0].cells.delete('B4');
    expect(applyConstantPlug(model, ctx)).toEqual([]);
    const different = readWorkbook(plugWorkbook());
    different.sheets[0].cells.get('B4')!.r1c1 = 'RC[-1]*3';
    expect(applyConstantPlug(different, ctx)).toEqual([]);
  });
  it('never treats an array/spill member as a plug', () => {
    const model = readWorkbook(plugWorkbook());
    model.sheets[0].cells.get('B3')!.inArray = true;
    expect(applyConstantPlug(model, ctx)).toEqual([]);
  });
  it('excludes numeric date-formatted constants', () => {
    const bytes = singleSheet(row(2, fml('B2', 'A2*2', 4)) + row(3, num('B3', 45000, 1)) + row(4, fml('B4', 'A4*2', 8)),
      { stylesXml: stylesXml({}, [0, 14]) });
    expect(applyConstantPlug(readWorkbook(bytes), ctx)).toEqual([]);
  });
  it('retains the labelled tax-rate by-design trap without claiming it is a confirmed defect', () => {
    expect(applyConstantPlug(readWorkbook(plugWorkbook(true)), ctx)).toMatchObject([{ cell: 'B3', tier: 'likely' }]);
  });
});

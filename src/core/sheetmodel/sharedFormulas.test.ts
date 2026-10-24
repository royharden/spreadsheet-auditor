import { describe, expect, it } from 'vitest';
import { readWorkbook } from './model.ts';
import { expandSharedFormula, markArrayMembers } from './sharedFormulas.ts';
import { num, row, singleSheet } from './testkit.ts';
import type { Cell } from './types.ts';

describe('expandSharedFormula', () => {
  it('re-bases the master text by the child offset', () => {
    const master = { row: 2, col: 3, formula: 'A2*$B$1+SUM(A$1:A2)' };
    expect(expandSharedFormula(master, 2, 3).formula).toBe('A2*$B$1+SUM(A$1:A2)');
    expect(expandSharedFormula(master, 5, 3).formula).toBe('A5*$B$1+SUM(A$1:A5)');
    expect(expandSharedFormula(master, 2, 4).formula).toBe('B2*$B$1+SUM(B$1:B2)');
  });

  it('never rewrites text inside string literals', () => {
    expect(expandSharedFormula({ row: 1, col: 2, formula: 'IF(A1>0,"A1 ok",A1)' }, 3, 2).formula).toBe('IF(A3>0,"A1 ok",A3)');
  });

  it('flags children that would reference outside the sheet', () => {
    const r = expandSharedFormula({ row: 5, col: 2, formula: 'A1+B5' }, 1, 2);
    expect(r).toEqual({ formula: '#REF!+B1', outOfBounds: true });
  });
});

describe('shared formulas through readWorkbook', () => {
  const rows =
    row(1, num('A1', 10) + '<c r="B1"><f t="shared" ref="B1:B4" si="0">A1*2</f><v>20</v></c>') +
    row(2, num('A2', 11) + '<c r="B2"><f t="shared" si="0"/><v>22</v></c>') +
    row(3, num('A3', 12) + '<c r="B3"><f t="shared" si="0"/><v>24</v></c>') +
    row(4, num('A4', 13) + '<c r="B4"><f t="shared" si="0"/></c>') +
    row(5, '<c r="C5"><f t="shared" si="7"/><v>1</v></c>');
  const model = readWorkbook(singleSheet(rows));
  const cells = model.sheets[0].cells;

  it('expands every child from its master', () => {
    expect(cells.get('B1')).toMatchObject({ formula: 'A1*2', formulaKind: 'shared', cachedValue: 20 });
    expect(cells.get('B2')).toMatchObject({ formula: 'A2*2', formulaKind: 'shared', cachedValue: 22 });
    expect(cells.get('B3')).toMatchObject({ formula: 'A3*2', formulaKind: 'shared' });
    expect(cells.get('B4')).toMatchObject({ formula: 'A4*2', cachedType: 'none', cachedValue: null });
  });

  it('gives expanded children the same R1C1 form as the master', () => {
    const r1c1 = ['B1', 'B2', 'B3', 'B4'].map((a) => cells.get(a)?.r1c1);
    expect(new Set(r1c1)).toEqual(new Set(['RC[-1]*2']));
  });

  it('treats a child without a master as opaque instead of guessing', () => {
    expect(cells.get('C5')).toMatchObject({ formulaKind: 'shared', opaque: ['unresolved-shared'] });
    expect(cells.get('C5')?.formula).toBeUndefined();
    expect(model.coverage.opaque).toContainEqual({ cell: "'Sheet1'!C5", category: 'unresolved-shared' });
  });

  it('counts the children as formula cells', () => {
    expect(model.coverage.formulaCells).toBe(5);
  });

  it('expands children that appear before their master in the file', () => {
    const early = readWorkbook(
      singleSheet(
        row(1, '<c r="D1"><f t="shared" si="3"/><v>1</v></c>') +
          row(2, '<c r="D2"><f t="shared" ref="D1:D2" si="3">C2+1</f><v>2</v></c>'),
      ),
    );
    expect(early.sheets[0].cells.get('D1')?.formula).toBe('C1+1');
  });
});

describe('array formulas', () => {
  const rows =
    row(1, num('A1', 1) + '<c r="C1"><f t="array" ref="C1:C3">A1:A3*2</f><v>2</v></c>') +
    row(2, num('A2', 2) + '<c r="C2"><v>4</v></c>') +
    row(3, num('A3', 3) + '<c r="C3"><v>6</v></c>') +
    row(4, '<c r="C4"><v>8</v></c>');
  const cells = readWorkbook(singleSheet(rows)).sheets[0].cells;

  it('records the anchor ref and marks every stored member inArray', () => {
    expect(cells.get('C1')).toMatchObject({ formulaKind: 'array', arrayRef: 'C1:C3', inArray: true, formula: 'A1:A3*2' });
    expect(cells.get('C2')).toMatchObject({ inArray: true, arrayAnchor: 'C1', cachedValue: 4 });
    expect(cells.get('C3')).toMatchObject({ inArray: true, arrayAnchor: 'C1' });
    expect(cells.get('C2')?.formula).toBeUndefined();
  });

  it('does not mark cells outside the array range', () => {
    expect(cells.get('C4')?.inArray).toBeUndefined();
    expect(cells.get('A2')?.inArray).toBeUndefined();
  });

  it('marks members of a large array by scanning stored cells', () => {
    const map = new Map<string, Cell>();
    const mk = (addr: string, r: number, c: number): Cell => {
      const cell: Cell = { addr, row: r, col: c, cachedType: 'n', cachedValue: 1, isPercentFmt: false, isDateFmt: false };
      map.set(addr, cell);
      return cell;
    };
    const anchor = mk('A1', 1, 1);
    mk('A9000', 9000, 1);
    mk('B9000', 9000, 2);
    const marked = markArrayMembers(map, anchor, { start: { row: 1, col: 1 }, end: { row: 10_000, col: 1 } });
    expect(marked).toBe(2);
    expect(map.get('A9000')?.inArray).toBe(true);
    expect(map.get('B9000')?.inArray).toBeUndefined();
  });
});

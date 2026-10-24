import { describe, expect, it } from 'vitest';
import {
  canonicalCellRef,
  colToLetters,
  formatA1,
  formatRange,
  lettersToCol,
  parseA1,
  parseCellRef,
  parseRangeA1,
  quoteSheetName,
  rangeContains,
  splitCellRef,
  toA1,
  toCellRef,
} from './addr.ts';

describe('column letters', () => {
  it.each([
    [1, 'A'],
    [26, 'Z'],
    [27, 'AA'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
    [16384, 'XFD'],
  ])('%i <-> %s', (col, letters) => {
    expect(colToLetters(col)).toBe(letters);
    expect(lettersToCol(letters)).toBe(col);
    expect(lettersToCol(letters.toLowerCase())).toBe(col);
  });

  it('refuses columns outside A..XFD', () => {
    expect(() => colToLetters(0)).toThrow(RangeError);
    expect(() => colToLetters(16385)).toThrow(RangeError);
    expect(lettersToCol('XFE')).toBeNull();
    expect(lettersToCol('ABCD')).toBeNull();
    expect(lettersToCol('A1')).toBeNull();
  });
});

describe('A1 <-> row/col', () => {
  it('formats and parses plain and anchored addresses', () => {
    expect(toA1(12, 2)).toBe('B12');
    expect(parseA1('B12')).toEqual({ row: 12, col: 2, rowAbs: false, colAbs: false });
    expect(parseA1('$B$12')).toEqual({ row: 12, col: 2, rowAbs: true, colAbs: true });
    expect(parseA1('$B12')).toEqual({ row: 12, col: 2, rowAbs: false, colAbs: true });
    expect(parseA1('b$12')).toEqual({ row: 12, col: 2, rowAbs: true, colAbs: false });
    expect(formatA1({ row: 12, col: 2, rowAbs: true, colAbs: false })).toBe('B$12');
  });

  it('rejects malformed and out-of-sheet addresses', () => {
    expect(parseA1('B0')).toBeNull();
    expect(parseA1('A1048577')).toBeNull();
    expect(parseA1('XFE1')).toBeNull();
    expect(parseA1('1A')).toBeNull();
    expect(parseA1('A1:B2')).toBeNull();
    expect(() => toA1(0, 1)).toThrow(RangeError);
  });

  it('round-trips the sheet corners', () => {
    expect(parseA1(toA1(1, 1))).toMatchObject({ row: 1, col: 1 });
    expect(parseA1(toA1(1_048_576, 16_384))).toMatchObject({ row: 1_048_576, col: 16_384 });
  });
});

describe('canonical CellRef', () => {
  it("always quotes the sheet and doubles '", () => {
    expect(quoteSheetName('Sheet1')).toBe("'Sheet1'");
    expect(toCellRef('Sheet1', 3, 1)).toBe("'Sheet1'!A3");
    expect(toCellRef("O'Brien Q3", 1, 2)).toBe("'O''Brien Q3'!B1");
  });

  it('parses qualified references in every form', () => {
    expect(parseCellRef("'My ''Sheet'''!$B$2")).toEqual({ sheet: "My 'Sheet'", row: 2, col: 2, rowAbs: true, colAbs: true });
    expect(parseCellRef('Sheet1!C3')).toEqual({ sheet: 'Sheet1', row: 3, col: 3, rowAbs: false, colAbs: false });
    expect(parseCellRef("'Q3 Budget'!A1")).toMatchObject({ sheet: 'Q3 Budget', row: 1, col: 1 });
    expect(parseCellRef('D4')).toEqual({ sheet: null, row: 4, col: 4, rowAbs: false, colAbs: false });
  });

  it('rejects ranges, 3-D refs and junk', () => {
    expect(parseCellRef('Sheet1!A1:B2')).toBeNull();
    expect(parseCellRef('Sheet1:Sheet3!A1')).toBeNull();
    expect(parseCellRef('[1]Sheet1!A1')).toBeNull();
    expect(parseCellRef('hello')).toBeNull();
  });

  it('canonicalises with a default sheet and strips anchors', () => {
    expect(canonicalCellRef('$B$2', 'Data')).toBe("'Data'!B2");
    expect(canonicalCellRef("'O''Brien'!c7", 'Data')).toBe("'O''Brien'!C7");
    expect(canonicalCellRef('Other!A1', 'Data')).toBe("'Other'!A1");
  });

  it('splits a canonical ref back', () => {
    expect(splitCellRef("'O''Brien'!C7")).toEqual({ sheet: "O'Brien", row: 7, col: 3 });
    expect(splitCellRef('C7')).toBeNull();
  });
});

describe('ranges', () => {
  it('normalises reversed corners and single cells', () => {
    expect(parseRangeA1('B3:A1')).toEqual({ start: { row: 1, col: 1 }, end: { row: 3, col: 2 } });
    expect(parseRangeA1('$C$5')).toEqual({ start: { row: 5, col: 3 }, end: { row: 5, col: 3 } });
    expect(parseRangeA1('A1:B2:C3')).toBeNull();
    expect(formatRange({ start: { row: 1, col: 1 }, end: { row: 3, col: 2 } })).toBe('A1:B3');
  });

  it('tests containment inclusively', () => {
    const r = { start: { row: 2, col: 2 }, end: { row: 4, col: 3 } };
    expect(rangeContains(r, 2, 2)).toBe(true);
    expect(rangeContains(r, 4, 3)).toBe(true);
    expect(rangeContains(r, 5, 3)).toBe(false);
    expect(rangeContains(r, 3, 1)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { opaqueCategories, tokenize, type Token } from './tokenizer.ts';

const kinds = (f: string): string[] => tokenize(f).map((t) => t.kind);
const texts = (f: string): string[] => tokenize(f).map((t) => t.text);
const only = (f: string): Token => {
  const ts = tokenize(f);
  expect(ts).toHaveLength(1);
  return ts[0];
};

describe('tokenize: basic kinds', () => {
  it('splits a mixed formula into every kind', () => {
    const f = 'SUM(A1:B2,$C$3)*-1.5E+3+"txt"&TRUE<>#N/A';
    expect(kinds(f)).toEqual([
      'func',
      'paren',
      'range',
      'comma',
      'ref',
      'paren',
      'op',
      'op',
      'num',
      'op',
      'str',
      'op',
      'bool',
      'op',
      'err',
    ]);
    expect(texts(f)).toEqual(['SUM', '(', 'A1:B2', ',', '$C$3', ')', '*', '-', '1.5E+3', '+', '"txt"', '&', 'TRUE', '<>', '#N/A']);
  });

  it('skips a leading = and keeps positions relative to the input', () => {
    const f = '=A1+B2';
    const ts = tokenize(f);
    expect(ts.map((t) => t.text)).toEqual(['A1', '+', 'B2']);
    for (const t of ts) expect(f.slice(t.start, t.end)).toBe(t.text);
  });

  it('keeps text === source.slice(start, end) for every token of a complex formula', () => {
    const f = "IF('My ''Sheet'''!$A$1>=0.5, SUM(Table1[[#This Row],[Amount]]), [1]Rates!B2 & \"a\"\"b\")";
    for (const t of tokenize(f)) expect(f.slice(t.start, t.end)).toBe(t.text);
  });

  it('reads numbers in all notations', () => {
    expect(tokenize('1+.5+2.+3E-2+10').filter((t) => t.kind === 'num').map((t) => (t.kind === 'num' ? t.value : null))).toEqual([
      1, 0.5, 2, 0.03, 10,
    ]);
  });

  it('reads comparison and other operators', () => {
    expect(texts('A1<=B1')).toEqual(['A1', '<=', 'B1']);
    expect(texts('A1>=B1')).toEqual(['A1', '>=', 'B1']);
    expect(texts('A1<>B1')).toEqual(['A1', '<>', 'B1']);
    expect(texts('A1^2%')).toEqual(['A1', '^', '2', '%']);
    expect(texts('@A1:A3')).toEqual(['@', 'A1:A3']);
  });

  it('reads array constants with brace parens and ; row separators', () => {
    expect(kinds('{1,2;3,4}')).toEqual(['paren', 'num', 'comma', 'num', 'comma', 'num', 'comma', 'num', 'paren']);
  });

  it('reads booleans case-insensitively but TRUE( as a function', () => {
    expect(only('false')).toMatchObject({ kind: 'bool', value: false });
    expect(tokenize('TRUE()')[0]).toMatchObject({ kind: 'func', name: 'TRUE' });
  });
});

describe('tokenize: references and anchors', () => {
  it('parses mixed anchors', () => {
    expect(only('$A1')).toMatchObject({ kind: 'ref', cell: { row: 1, col: 1, colAbs: true, rowAbs: false } });
    expect(only('A$1')).toMatchObject({ kind: 'ref', cell: { row: 1, col: 1, colAbs: false, rowAbs: true } });
    expect(only('$A$1')).toMatchObject({ kind: 'ref', cell: { colAbs: true, rowAbs: true } });
    expect(only('b7')).toMatchObject({ kind: 'ref', cell: { row: 7, col: 2 } });
    expect(only('$B$2:C$9')).toMatchObject({
      kind: 'range',
      from: { row: 2, col: 2, rowAbs: true, colAbs: true },
      to: { row: 9, col: 3, rowAbs: true, colAbs: false },
    });
  });

  it('parses quoted sheet names with doubled quotes', () => {
    expect(only("'My ''Sheet'''!A1")).toMatchObject({
      kind: 'ref',
      sheet: "My 'Sheet'",
      prefix: "'My ''Sheet'''!",
      cell: { row: 1, col: 1 },
    });
    expect(only("'Q3 Budget'!B2:B9")).toMatchObject({ kind: 'range', sheet: 'Q3 Budget' });
  });

  it('parses unquoted sheet prefixes', () => {
    expect(only('Sheet2!$C$4')).toMatchObject({ kind: 'ref', sheet: 'Sheet2', prefix: 'Sheet2!' });
    expect(only('Data.2024!A1')).toMatchObject({ kind: 'ref', sheet: 'Data.2024' });
  });

  it('does not mistake function names or long identifiers for references', () => {
    expect(tokenize('LOG10(A1)')[0]).toMatchObject({ kind: 'func', name: 'LOG10' });
    expect(tokenize('ATAN2(1,2)')[0]).toMatchObject({ kind: 'func', name: 'ATAN2' });
    expect(tokenize('_xlfn.XLOOKUP(A1,B:B,C:C)')[0]).toMatchObject({ kind: 'func', name: '_XLFN.XLOOKUP' });
    expect(only('TaxRate')).toMatchObject({ kind: 'name', name: 'TaxRate' });
    expect(only('ABC1D')).toMatchObject({ kind: 'name' });
    expect(only('XFE1')).toMatchObject({ kind: 'name' }); // beyond column XFD
    expect(only('A1048577')).toMatchObject({ kind: 'name' }); // beyond the last row
    expect(only('R1C1')).toMatchObject({ kind: 'name' });
  });

  it('reads sheet-scoped names', () => {
    expect(only('Sheet1!LocalRate')).toMatchObject({ kind: 'name', sheet: 'Sheet1', name: 'LocalRate' });
  });
});

describe('tokenize: errors and string-literal immunity', () => {
  it('reads every error literal, including sheet-qualified #REF!', () => {
    for (const e of ['#REF!', '#DIV/0!', '#N/A', '#NAME?', '#VALUE!', '#NUM!', '#NULL!', '#SPILL!', '#CALC!', '#GETTING_DATA']) {
      expect(only(e)).toMatchObject({ kind: 'err', value: e });
    }
    expect(only('#ref!')).toMatchObject({ kind: 'err', value: '#REF!' });
    expect(only('Sheet2!#REF!')).toMatchObject({ kind: 'err', value: '#REF!', sheet: 'Sheet2' });
    expect(only("'Old Sheet'!#REF!")).toMatchObject({ kind: 'err', value: '#REF!', sheet: 'Old Sheet' });
    expect(kinds('SUM(#REF!,A1)')).toEqual(['func', 'paren', 'err', 'comma', 'ref', 'paren']);
  });

  it('never finds references or errors inside string literals', () => {
    const ts = tokenize('"A1 #REF! Sheet1!B2 ""quoted"""&B1');
    expect(ts.map((t) => t.kind)).toEqual(['str', 'op', 'ref']);
    expect(ts[0]).toMatchObject({ kind: 'str', value: 'A1 #REF! Sheet1!B2 "quoted"' });
    expect(ts.filter((t) => t.kind === 'err')).toHaveLength(0);
  });

  it('turns an unterminated string into one unparsed opaque token', () => {
    expect(tokenize('A1&"oops')).toMatchObject([{ kind: 'ref' }, { kind: 'op' }, { kind: 'opaque', category: 'unparsed' }]);
  });

  it('reads the spill operator after a reference', () => {
    expect(texts('SUM(A1#)')).toEqual(['SUM', '(', 'A1', '#', ')']);
    expect(tokenize('SUM(A1#)')[3]).toMatchObject({ kind: 'op' });
  });
});

describe('tokenize: opaque classification', () => {
  it.each([
    ['Table1[Amount]', 'structured-ref'],
    ['Table1[[#This Row],[Amount]]', 'structured-ref'],
    ['[@Amount]', 'structured-ref'],
    ['T1[Col]', 'structured-ref'],
    ['Sheet1:Sheet3!A1', '3d-ref'],
    ["'Jan 2024:Mar 2024'!B2:B9", '3d-ref'],
    ['[1]Sheet1!A1', 'external-ref'],
    ["'[Budget.xlsx]Q3'!$B$2", 'external-ref'],
    ["'C:\\Finance\\[Rates.xlsx]Rates'!A1", 'external-ref'],
    ['[2]!GlobalName', 'external-ref'],
    ['A:A', 'whole-column'],
    ['$B:$D', 'whole-column'],
    ['Sheet2!C:C', 'whole-column'],
    ['1:1', 'whole-row'],
    ['$2:$5', 'whole-row'],
  ])('%s is opaque %s', (f, category) => {
    expect(only(f)).toMatchObject({ kind: 'opaque', category });
  });

  it('keeps shiftable targets on reference-like opaque tokens', () => {
    expect(only('$B:D')).toMatchObject({ target: { type: 'cols', from: { index: 2, abs: true }, to: { index: 4, abs: false } } });
    expect(only('3:$7')).toMatchObject({ target: { type: 'rows', from: { index: 3, abs: false }, to: { index: 7, abs: true } } });
    expect(only('Sheet1:Sheet3!B2')).toMatchObject({
      sheet: 'Sheet1',
      sheetEnd: 'Sheet3',
      target: { type: 'cell', cell: { row: 2, col: 2 } },
    });
    expect(only('[1]Rates!A1:B2')).toMatchObject({ book: '1', sheet: 'Rates', target: { type: 'area' } });
    expect(only("'C:\\Finance\\[Rates.xlsx]Rates'!A1")).toMatchObject({ book: 'C:\\Finance\\Rates.xlsx', sheet: 'Rates' });
    expect(only('Table1[Amount]')).not.toHaveProperty('target');
  });

  it('reports distinct opaque categories of a formula', () => {
    expect(opaqueCategories(tokenize('SUM(A:A)+SUM(B:B)+Table1[x]'))).toEqual(['whole-column', 'structured-ref']);
    expect(opaqueCategories(tokenize('A1+B1'))).toEqual([]);
  });

  it('never throws on junk and marks it unparsed', () => {
    for (const junk of ['~', '!', '$', "'abc", '[[', 'A1 ~ B1', '\u0000']) {
      expect(() => tokenize(junk)).not.toThrow();
    }
    expect(opaqueCategories(tokenize('A1~B1'))).toEqual(['unparsed']);
  });
});

describe('tokenize: whitespace', () => {
  it('drops ordinary whitespace', () => {
    expect(texts('SUM( A1 , B1 )')).toEqual(['SUM', '(', 'A1', ',', 'B1', ')']);
    expect(texts('A1 + B1')).toEqual(['A1', '+', 'B1']);
  });

  it('keeps whitespace between two operands as the intersection operator', () => {
    const ts = tokenize('A1:C3 B2:D4');
    expect(ts.map((t) => t.kind)).toEqual(['range', 'op', 'range']);
    expect(ts[1].text).toBe(' ');
  });
});

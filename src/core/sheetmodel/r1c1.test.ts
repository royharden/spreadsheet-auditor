import { describe, expect, it } from 'vitest';
import { cellPartToR1C1, formatCellPart, parseR1C1Cell, rebaseFormula, sheetNameResolver, toR1C1 } from './r1c1.ts';
import { tokenize } from './tokenizer.ts';

const at = (row: number, col: number) => ({ row, col });

describe('toR1C1', () => {
  it('writes relative, absolute and mixed references', () => {
    // Anchor C5 (row 5, col 3).
    expect(toR1C1('A1', at(5, 3))).toBe('R[-4]C[-2]');
    expect(toR1C1('C5', at(5, 3))).toBe('RC');
    expect(toR1C1('$A$1', at(5, 3))).toBe('R1C1');
    expect(toR1C1('$A1', at(5, 3))).toBe('R[-4]C1');
    expect(toR1C1('A$1', at(5, 3))).toBe('R1C[-2]');
    expect(toR1C1('D6', at(5, 3))).toBe('R[1]C[1]');
  });

  it('normalises both axes of ranges, whole columns and whole rows', () => {
    expect(toR1C1('SUM(B2:B9)', at(10, 2))).toBe('SUM(R[-8]C:R[-1]C)');
    expect(toR1C1('SUM(A:A)', at(1, 2))).toBe('SUM(C[-1]:C[-1])');
    expect(toR1C1('SUM($A:$B)', at(1, 2))).toBe('SUM(C1:C2)');
    expect(toR1C1('SUM(3:3)', at(5, 1))).toBe('SUM(R[-2]:R[-2])');
  });

  it('keeps sheet prefixes in canonical quoted form', () => {
    expect(toR1C1('Data!B2*2', at(2, 3))).toBe("'Data'!RC[-1]*2");
    expect(toR1C1("'Data'!B2*2", at(2, 3))).toBe("'Data'!RC[-1]*2");
    expect(toR1C1("'O''Brien'!A1", at(1, 1))).toBe("'O''Brien'!RC");
  });

  it('normalises sheet-prefix case to the workbook spelling when given a resolver', () => {
    // Regression (M1 review #2): 'DATA'! and 'Data'! must give the same R1C1.
    const resolve = sheetNameResolver(['Data', "O'Brien"]);
    const expected = "'Data'!RC[-1]*2";
    expect(toR1C1("'DATA'!B2*2", at(2, 3), resolve)).toBe(expected);
    expect(toR1C1('data!B2*2', at(2, 3), resolve)).toBe(expected);
    expect(toR1C1('Data!B2*2', at(2, 3), resolve)).toBe(expected);
    expect(toR1C1("'o''brien'!A1", at(1, 1), resolve)).toBe("'O''Brien'!RC");
    expect(toR1C1('SUM(DATA!A:A)', at(1, 1), resolve)).toBe("SUM('Data'!C:C)");
    expect(toR1C1('DATA!#REF!+DATA!Rate+DATA!Fn(1)', at(1, 1), resolve)).toBe("'Data'!#REF!+'Data'!RATE+'Data'!FN(1)");
    // Unknown sheets keep their spelling; without a resolver the spelling is kept as written.
    expect(toR1C1('Other!A1', at(1, 1), resolve)).toBe("'Other'!RC");
    expect(toR1C1("'DATA'!B2", at(2, 3))).toBe("'DATA'!RC[-1]");
  });

  it('upper-cases functions, names and booleans and drops insignificant whitespace', () => {
    expect(toR1C1('sum( a1 , taxRate ) + true', at(1, 2))).toBe('SUM(RC[-1],TAXRATE)+TRUE');
    expect(toR1C1('A1:B2 B1:C3', at(5, 5))).toBe('R[-4]C[-4]:R[-3]C[-3] R[-4]C[-3]:R[-2]C[-2]');
  });

  it('leaves string literals untouched', () => {
    expect(toR1C1('"A1"&A1', at(1, 2))).toBe('"A1"&RC[-1]');
  });

  it('gives copies of one formula the same R1C1 (copy-down invariance)', () => {
    // B3 = A3*$E$1 copied down to B4 = A4*$E$1.
    expect(toR1C1('A3*$E$1', at(3, 2))).toBe(toR1C1('A4*$E$1', at(4, 2)));
    // A drifted copy differs.
    expect(toR1C1('A3*$E$2', at(4, 2))).not.toBe(toR1C1('A4*$E$1', at(4, 2)));
    expect(toR1C1('A3*$E$1', at(4, 2))).not.toBe(toR1C1('A4*$E$1', at(4, 2)));
  });
});

describe('R1C1 cell round trip', () => {
  it.each(['A1', '$A$1', '$C7', 'C$7', 'XFD1048576', 'B2'])('%s survives A1 -> R1C1 -> A1 at several anchors', (a1) => {
    const tok = tokenize(a1)[0];
    if (tok.kind !== 'ref') throw new Error('expected a ref');
    for (const anchor of [at(1, 1), at(7, 3), at(1_048_576, 16_384), at(500, 200)]) {
      const r1c1 = cellPartToR1C1(tok.cell, anchor);
      const back = parseR1C1Cell(r1c1, anchor);
      expect(back).toEqual(tok.cell);
      expect(back && formatCellPart(back)).toBe(a1);
    }
  });

  it('rejects R1C1 references that leave the sheet', () => {
    expect(parseR1C1Cell('R[-1]C', at(1, 1))).toBeNull();
    expect(parseR1C1Cell('RC[1]', at(1, 16_384))).toBeNull();
    expect(parseR1C1Cell('R0C1', at(1, 1))).toBeNull();
    expect(parseR1C1Cell('nonsense', at(1, 1))).toBeNull();
  });
});

describe('rebaseFormula (token shift)', () => {
  it('shifts relative parts only', () => {
    expect(rebaseFormula('A1+$B$1+$C1+D$1', 2, 1).formula).toBe('B3+$B$1+$C3+E$1');
  });

  it('shifts ranges, whole rows/columns and prefixed references', () => {
    expect(rebaseFormula('SUM(B2:B9)', 0, 1).formula).toBe('SUM(C2:C9)');
    expect(rebaseFormula("SUM('My Sheet'!A1:A3)", 1, 0).formula).toBe("SUM('My Sheet'!A2:A4)");
    expect(rebaseFormula('SUM(A:A)+SUM(1:1)', 1, 1).formula).toBe('SUM(B:B)+SUM(2:2)');
    expect(rebaseFormula('SUM(Jan:Mar!B2)', 1, 0).formula).toBe('SUM(Jan:Mar!B3)');
  });

  it('never touches string literals or names', () => {
    expect(rebaseFormula('"A1"&A1&TaxRate', 1, 0).formula).toBe('"A1"&A2&TaxRate');
  });

  it('preserves spacing and the leading =', () => {
    expect(rebaseFormula('=SUM( A1 , B1 )', 1, 0).formula).toBe('=SUM( A2 , B2 )');
  });

  it('round-trips: shifting by d then by -d gives the original', () => {
    const f = "IF(A2>$B$1,SUM(C2:C9)*Data!D$4,'Q3'!$E5)";
    const there = rebaseFormula(f, 3, 2);
    expect(there.outOfBounds).toBe(false);
    expect(rebaseFormula(there.formula, -3, -2).formula).toBe(f);
  });

  it('turns references that leave the sheet into #REF! (keeping the sheet prefix)', () => {
    const r = rebaseFormula('A1+Data!B1', -1, 0);
    expect(r.formula).toBe('#REF!+Data!#REF!');
    expect(r.outOfBounds).toBe(true);
    expect(rebaseFormula('XFD1', 0, 1)).toEqual({ formula: '#REF!', outOfBounds: true });
  });

  it('is the identity for a zero shift', () => {
    expect(rebaseFormula('a1 + b1', 0, 0)).toEqual({ formula: 'a1 + b1', outOfBounds: false });
  });
});

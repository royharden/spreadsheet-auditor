import { describe, expect, it } from 'vitest';
import { isDateFormat, isPercentFormat, parseStyles, scanFormatCode } from './styles.ts';
import { stylesXml } from './testkit.ts';
import { parseXmlText } from './xml.ts';

describe('scanFormatCode', () => {
  it.each([
    ['0%', true, false],
    ['0.0%', true, false],
    ['"%"0', false, false],
    ['0\\%', false, false],
    ['[Red]0.00%;[Blue]-0.00%', true, false],
    ['yyyy-mm-dd', false, true],
    ['yyyy\\-mm\\-dd', false, true],
    ['[$-409]d-mmm-yy;@', false, true],
    ['h:mm AM/PM', false, true],
    ['[h]', false, false],
    ['#,##0.00_);(#,##0.00)', false, false],
    ['0 "days"', false, false],
    ['General', false, false],
    ['0.00E+00', false, false],
    ['[Red]0.00', false, false],
    ['* #,##0', false, false],
  ])('%s -> percent %s, date %s', (code, percent, date) => {
    expect(scanFormatCode(code)).toEqual({ percent, date });
  });
});

describe('built-in ids', () => {
  it('treats 9 and 10 as percent', () => {
    expect(isPercentFormat(9, undefined)).toBe(true);
    expect(isPercentFormat(10, undefined)).toBe(true);
    expect(isPercentFormat(2, '0.00')).toBe(false);
  });

  it('treats 14-22 and 45-47 as dates, others not', () => {
    for (const id of [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]) expect(isDateFormat(id, undefined)).toBe(true);
    for (const id of [0, 1, 2, 9, 11, 13, 23, 44, 48, 49]) expect(isDateFormat(id, undefined)).toBe(false);
  });

  it('scans custom codes for dates', () => {
    expect(isDateFormat(164, 'dd/mm/yyyy')).toBe(true);
    expect(isDateFormat(165, '0.0%')).toBe(false);
  });
});

describe('parseStyles', () => {
  const doc = parseXmlText(
    stylesXml({ 164: '0.0%', 165: '"%"0', 166: 'yyyy\\-mm\\-dd', 167: '#,##0 "units"' }, [0, 9, 14, 164, 165, 166, 167, 10]),
    'xl/styles.xml',
  );
  const styles = parseStyles(doc);

  it('maps style ids to number formats with percent/date flags', () => {
    expect(styles.xfCount).toBe(8);
    expect(styles.cellFormat(0)).toMatchObject({ numFmtId: 0, numFmtCode: 'General', isPercent: false, isDate: false });
    expect(styles.cellFormat(1)).toMatchObject({ numFmtId: 9, numFmtCode: '0%', isPercent: true, isDate: false });
    expect(styles.cellFormat(2)).toMatchObject({ numFmtId: 14, isPercent: false, isDate: true });
    expect(styles.cellFormat(3)).toMatchObject({ numFmtId: 164, numFmtCode: '0.0%', isPercent: true, isDate: false });
    expect(styles.cellFormat(4)).toMatchObject({ numFmtId: 165, numFmtCode: '"%"0', isPercent: false });
    expect(styles.cellFormat(5)).toMatchObject({ numFmtId: 166, isDate: true, isPercent: false });
    expect(styles.cellFormat(6)).toMatchObject({ numFmtId: 167, isDate: false, isPercent: false });
    expect(styles.cellFormat(7)).toMatchObject({ numFmtId: 10, isPercent: true });
  });

  it('lets a workbook redefine a built-in id, and isDateFormat agrees with cellFormat (one shared rule)', () => {
    // Regression (M1 review #3): cellFormat and the exported isDateFormat used separate logic.
    const custom: Record<number, string> = { 2: 'yyyy-mm-dd', 164: 'dd/mm/yyyy', 165: '0.0%', 9: '0%' };
    const ids = [0, 2, 9, 14, 30, 47, 164, 165];
    const s = parseStyles(parseXmlText(stylesXml(custom, ids), 'xl/styles.xml'));
    expect(s.cellFormat(1)).toMatchObject({ numFmtId: 2, numFmtCode: 'yyyy-mm-dd', isDate: true });
    ids.forEach((id, styleId) => {
      const f = s.cellFormat(styleId);
      const expected = isDateFormat(id, f.numFmtCode, id in custom);
      expect(f.isDate, `numFmtId ${id}`).toBe(expected);
    });
    // Without the custom flag, a fixed built-in id is never re-scanned.
    expect(isDateFormat(2, 'yyyy-mm-dd')).toBe(false);
    expect(isDateFormat(2, 'yyyy-mm-dd', true)).toBe(true);
  });

  it('falls back to General for missing or out-of-range style ids', () => {
    expect(styles.cellFormat(undefined)).toMatchObject({ numFmtId: 0 });
    expect(styles.cellFormat(99)).toMatchObject({ numFmtId: 0, isPercent: false, isDate: false });
    expect(parseStyles(null).cellFormat(3)).toMatchObject({ numFmtId: 0 });
  });
});

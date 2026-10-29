import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../src/core/sheetmodel/index.ts';
import { sha256Hex } from '../src/core/util/sha256.ts';
import { formulaCell, newSheet, numberCell, textCell } from './cellmodel.ts';
import { writeXlsx } from './xlsxWriter.ts';

describe('canonical SpreadsheetML writer', () => {
  it('fixes part order and DOS mtime, independent of cell/comment insertion order', () => {
    const sheet = newSheet('A & B');
    sheet.cells.C3 = formulaCell('A3+B3', 3);
    sheet.cells.B3 = numberCell(2);
    sheet.cells.A3 = numberCell(1);
    sheet.comments.C3 = 'Second';
    sheet.comments.A3 = 'First';
    const first = writeXlsx({ sheets: [sheet] });
    const reversed = { ...sheet, cells: Object.fromEntries(Object.entries(sheet.cells).reverse()), comments: Object.fromEntries(Object.entries(sheet.comments).reverse()) };
    const second = writeXlsx({ sheets: [reversed] });
    expect(sha256Hex(first)).toBe(sha256Hex(second));
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe((20 << 9) | (1 << 5) | 1);
    expect(Object.keys(unzipSync(first))).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml',
    ]);
  });

  it('round-trips XML-sensitive text, typed caches, percent/date styles, and missing caches', () => {
    const sheet = newSheet("O'Brien & Co");
    sheet.cells.A1 = textCell('<ignore & "quote">');
    sheet.cells.A2 = formulaCell('IF(1<2,"a&b","c")', 'a&b');
    sheet.cells.A3 = formulaCell('1/0', '#DIV/0!', true);
    sheet.cells.A4 = formulaCell('2+2', null);
    sheet.cells.A5 = numberCell(0.05, 'percent');
    sheet.cells.A6 = numberCell(45000, 'date');
    sheet.cells.A7 = { value: true };
    const bytes = writeXlsx({ sheets: [sheet] });
    const parsed = readWorkbook(bytes).sheets[0];
    expect(parsed.name).toBe(sheet.name);
    expect(parsed.cells.get('A1')?.cachedValue).toBe('<ignore & "quote">');
    expect(parsed.cells.get('A2')).toMatchObject({ cachedType: 'str', cachedValue: 'a&b' });
    expect(parsed.cells.get('A3')).toMatchObject({ cachedType: 'e', cachedValue: '#DIV/0!' });
    expect(parsed.cells.get('A4')).toMatchObject({ cachedType: 'none', cachedValue: null });
    expect(parsed.cells.get('A5')?.isPercentFmt).toBe(true);
    expect(parsed.cells.get('A6')?.isDateFmt).toBe(true);
    expect(parsed.cells.get('A7')).toMatchObject({ cachedType: 'b', cachedValue: true });
    expect(strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])).toContain('&lt;ignore &amp; &quot;quote&quot;&gt;');
  });

  it('refuses illegal or duplicate sheet names and non-finite caches', () => {
    expect(() => writeXlsx({ sheets: [newSheet('bad:name')] })).toThrow();
    expect(() => writeXlsx({ sheets: [newSheet('Sheet'), newSheet('sheet')] })).toThrow();
    expect(() => numberCell(Infinity)).toThrow();
  });
});

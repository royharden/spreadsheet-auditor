import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { colToLetters } from '../util/addr.ts';
import { DEFAULT_LIMITS, MAX_INFLATED_BYTES, resolveLimits } from './limits.ts';
import { readWorkbook } from './model.ts';
import {
  buildOverlappingZip,
  buildXlsx,
  catchGate,
  fml,
  num,
  rawXlsx,
  row,
  singleSheet,
  xlsxParts,
  zipParts,
  type XlsxSpec,
} from './testkit.ts';
import { checkFileName, isVbaProjectName, openZip } from './zipGate.ts';

const MiB = 1024 * 1024;
const BASIC: XlsxSpec = { sheets: [{ name: 'Sheet1', rows: row(1, num('A1', 1)) }] };

function code(fn: () => unknown): string | undefined {
  return catchGate(fn)?.code;
}

describe('zip gate: valid packages pass', () => {
  it('accepts a zipSync-built deflated .xlsx', () => {
    const model = readWorkbook(buildXlsx(BASIC), undefined, { fileName: 'book.xlsx' });
    expect(model.sheets[0].cells.get('A1')?.cachedValue).toBe(1);
  });

  it('accepts a stored (level 0) package', () => {
    expect(readWorkbook(buildXlsx(BASIC, 0)).sheets).toHaveLength(1);
  });

  it('accepts the hand-written raw zip of the same parts', () => {
    expect(readWorkbook(rawXlsx(BASIC)).sheets).toHaveLength(1);
  });

  it('only inflates what it reads and counts the bytes', () => {
    const zip = openZip(buildXlsx(BASIC), DEFAULT_LIMITS);
    expect(zip.inflatedBytes()).toBe(0);
    const bytes = zip.read('xl/workbook.xml');
    expect(zip.inflatedBytes()).toBe(bytes.length);
    zip.read('XL/WORKBOOK.XML'); // cached, case-insensitive
    expect(zip.inflatedBytes()).toBe(bytes.length);
  });
});

describe('zip gate: file-level refusals', () => {
  it.each(['book.xlsm', 'book.XLSB', 'legacy.xls', 'notes.csv', 'noextension'])('refuses %s by extension', (name) => {
    expect(code(() => checkFileName(name))).toBe('unsupported-extension');
    expect(code(() => readWorkbook(buildXlsx(BASIC), undefined, { fileName: name }))).toBe('unsupported-extension');
  });

  it('refuses an oversize compressed file before looking inside it', () => {
    const big = new Uint8Array(5 * MiB + 1);
    big[0] = 0x50;
    big[1] = 0x4b;
    const err = catchGate(() => readWorkbook(big));
    expect(err?.code).toBe('compressed-too-large');
    expect(err?.detail).toMatchObject({ bytes: 5 * MiB + 1, limit: 5 * MiB });
  });

  it('refuses OLE/CFB files (legacy .xls or encrypted workbooks)', () => {
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(code(() => readWorkbook(ole))).toBe('ole-compound-file');
  });

  it('refuses non-zip bytes', () => {
    expect(code(() => readWorkbook(new TextEncoder().encode('hello, this is not a workbook at all')))).toBe('not-zip');
    expect(code(() => readWorkbook(new Uint8Array(0)))).toBe('not-zip');
  });

  it('refuses a zip whose end record is missing', () => {
    const z = buildXlsx(BASIC);
    expect(code(() => readWorkbook(z.subarray(0, z.length - 10)))).toBe('bad-zip');
  });
});

describe('zip gate: entry refusals (central directory, before inflation)', () => {
  it('refuses vbaProject.bin in any letter case', () => {
    for (const name of ['xl/vbaProject.bin', 'xl/VBAProject.BIN', 'customUI/vbaproject.bin']) {
      const z = buildXlsx({ ...BASIC, extraParts: { [name]: new Uint8Array([1, 2, 3]) } });
      expect(code(() => readWorkbook(z))).toBe('vba-project');
    }
    expect(isVbaProjectName('xl/vbaProjectSignature.bin')).toBe(true);
    expect(isVbaProjectName('xl/media/image1.bin')).toBe(false);
  });

  it('refuses path traversal', () => {
    for (const name of ['../evil.xml', 'xl/../../evil.xml', 'xl/worksheets/../../../x']) {
      const z = rawXlsx(BASIC, {}, [{ name, data: '<x/>' }]);
      expect(code(() => readWorkbook(z))).toBe('path-traversal');
    }
  });

  it('refuses absolute paths', () => {
    for (const name of ['/xl/evil.xml', 'C:/evil.xml']) {
      const z = rawXlsx(BASIC, {}, [{ name, data: '<x/>' }]);
      expect(code(() => readWorkbook(z))).toBe('absolute-path');
    }
  });

  it('refuses backslash separators', () => {
    const z = rawXlsx(BASIC, {}, [{ name: 'xl\\evil.xml', data: '<x/>' }]);
    expect(code(() => readWorkbook(z))).toBe('backslash-in-name');
  });

  it('refuses duplicate entries, including case-insensitive duplicates', () => {
    const exact = rawXlsx(BASIC, {}, [{ name: 'xl/workbook.xml', data: '<workbook/>' }]);
    expect(code(() => readWorkbook(exact))).toBe('duplicate-entry');
    const cased = rawXlsx(BASIC, {}, [{ name: 'XL/Workbook.xml', data: '<workbook/>' }]);
    expect(code(() => readWorkbook(cased))).toBe('duplicate-entry');
  });

  it('refuses encrypted entries', () => {
    const z = rawXlsx(BASIC, { 'xl/workbook.xml': { flags: 0x1 } });
    expect(code(() => readWorkbook(z))).toBe('encrypted-entry');
  });

  it('refuses unknown compression methods', () => {
    const z = rawXlsx(BASIC, { 'xl/workbook.xml': { method: 12 } });
    expect(code(() => readWorkbook(z))).toBe('unsupported-compression');
  });

  it('enforces the part-count cap from the end record', () => {
    const extra = Array.from({ length: 2001 }, (_v, i) => ({ name: `xl/media/p${i}.txt`, data: 'x', method: 0 }));
    const z = rawXlsx(BASIC, {}, extra);
    const err = catchGate(() => readWorkbook(z));
    expect(err?.code).toBe('too-many-parts');
    expect(Number(err?.detail?.parts)).toBeGreaterThan(2000);
  });

  it('refuses a declared bomb (declared sizes over the cap) before inflating anything', () => {
    const z = rawXlsx(BASIC, { 'xl/worksheets/sheet1.xml': { declaredUncompressedSize: 60 * MiB } });
    expect(code(() => readWorkbook(z))).toBe('declared-too-large');
    // The cap is on the total: three 20 MB declarations also exceed 50 MB.
    const parts = ['a', 'b', 'c'].map((n) => ({ name: `xl/media/${n}.bin`, data: 'x', declaredUncompressedSize: 20 * MiB }));
    expect(code(() => openZip(rawXlsx(BASIC, {}, parts), DEFAULT_LIMITS))).toBe('declared-too-large');
  });

  it('refuses overlapping entries (one entry hidden inside the data of another)', () => {
    expect(code(() => openZip(buildOverlappingZip(), DEFAULT_LIMITS))).toBe('overlapping-entries');
  });
});

describe('zip gate: actual-byte caps during inflation', () => {
  it('aborts a lying-header bomb (declared small, inflates far past the cap) mid-stream', () => {
    const bomb = new Uint8Array(51 * MiB); // zeros: deflates to ~50 KB
    const payload = deflateSync(bomb, { level: 9 });
    expect(payload.length).toBeLessThan(DEFAULT_LIMITS.maxCompressedBytes);
    const z = rawXlsx(BASIC, {
      'xl/worksheets/sheet1.xml': { data: bomb.subarray(0, 1000), rawPayload: payload, declaredUncompressedSize: 1000 },
    });
    const err = catchGate(() => readWorkbook(z));
    expect(err?.code).toBe('entry-size-mismatch');
    // Aborted long before the full 51 MB was materialised.
    expect(Number(err?.detail?.inflatedBytes)).toBeLessThan(MAX_INFLATED_BYTES);
    expect(Number(err?.detail?.entryBytes)).toBeGreaterThan(1000);
  });

  it('aborts at the running actual-byte cap even when headers are honest', () => {
    const parts = xlsxParts(BASIC);
    // 20 MB of spaces: honest sizes, under the declared cap, deflates to a few KB.
    parts['xl/worksheets/sheet1.xml'] = new Uint8Array(20 * MiB).fill(0x20);
    const z = zipParts(parts);
    const err = catchGate(() => readWorkbook(z, { maxInflatedBytes: 256 * 1024 }));
    expect(err?.code).toBe('inflated-too-large');
    expect(Number(err?.detail?.limit)).toBe(256 * 1024);
    // Stopped after at most a few chunks, not after inflating all 20 MB.
    expect(Number(err?.detail?.inflatedBytes)).toBeLessThan(20 * MiB);
  });

  it('refuses an entry that inflates to fewer bytes than declared', () => {
    const z = rawXlsx(BASIC, { 'xl/workbook.xml': { declaredUncompressedSize: 100_000 } });
    expect(code(() => readWorkbook(z))).toBe('entry-size-mismatch');
  });

  it('refuses a corrupt deflate stream', () => {
    const z = rawXlsx(BASIC, { 'xl/workbook.xml': { rawPayload: new Uint8Array([0xff, 0xff, 0xff, 0xff]) } });
    expect(code(() => readWorkbook(z))).toBe('corrupt-entry');
  });
});

describe('package content refusals', () => {
  it('refuses macro content types in [Content_Types].xml', () => {
    const viaDefault = buildXlsx({
      ...BASIC,
      contentTypes: '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
    });
    expect(code(() => readWorkbook(viaDefault))).toBe('macro-content-type');
    const viaMain = buildXlsx({ ...BASIC, workbookContentType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' });
    expect(code(() => readWorkbook(viaMain))).toBe('macro-content-type');
    const viaMacrosheet = buildXlsx({
      ...BASIC,
      contentTypes: '<Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>',
    });
    expect(code(() => readWorkbook(viaMacrosheet))).toBe('macro-content-type');
  });

  it('refuses a DOCTYPE in any part it reads', () => {
    const doctype = '<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaa">]><worksheet><sheetData/></worksheet>';
    const z = buildXlsx({ sheets: [{ name: 'Sheet1', xml: doctype }] });
    expect(code(() => readWorkbook(z))).toBe('doctype-forbidden');
    const inSst = buildXlsx({ ...BASIC, sharedStringsXml: '<!ENTITY x "y"><sst><si><t>a</t></si></sst>' });
    expect(code(() => readWorkbook(inSst))).toBe('doctype-forbidden');
  });

  it('refuses a package without [Content_Types].xml or without a workbook', () => {
    expect(code(() => readWorkbook(buildXlsx({ ...BASIC, omit: ['[Content_Types].xml'] })))).toBe('missing-part');
    expect(code(() => readWorkbook(buildXlsx({ ...BASIC, omit: ['xl/workbook.xml'] })))).toBe('missing-part');
  });
});

describe('workbook caps', () => {
  it('refuses more than 20 sheets', () => {
    const sheets = Array.from({ length: 21 }, (_v, i) => ({ name: `S${i + 1}`, rows: '' }));
    const err = catchGate(() => readWorkbook(buildXlsx({ sheets })));
    expect(err?.code).toBe('too-many-sheets');
    expect(err?.detail).toMatchObject({ sheets: 21, limit: 20 });
    expect(readWorkbook(buildXlsx({ sheets: sheets.slice(0, 20) })).sheets).toHaveLength(20);
  });

  it('refuses more than 50,000 formula cells', () => {
    const rows: string[] = [];
    let n = 0;
    for (let r = 1; n < 50_001; r++) {
      const cells: string[] = [];
      for (let c = 1; c <= 100 && n < 50_001; c++, n++) cells.push(`<c r="${colToLetters(c)}${r}"><f>1</f></c>`);
      rows.push(row(r, cells.join('')));
    }
    const z = singleSheet(rows.join(''));
    const err = catchGate(() => readWorkbook(z));
    expect(err?.code).toBe('too-many-formulas');
    expect(err?.detail).toMatchObject({ limit: 50_000 });
  });

  it('counts formula cells across sheets and after shared-formula expansion', () => {
    // One master + four children = five formula cells.
    const shared =
      row(1, '<c r="B1"><f t="shared" ref="B1:B5" si="0">A1*2</f></c>') +
      [2, 3, 4, 5].map((r) => row(r, `<c r="B${r}"><f t="shared" si="0"/></c>`)).join('');
    const z = singleSheet(shared);
    expect(code(() => readWorkbook(z, { maxFormulaCells: 4 }))).toBe('too-many-formulas');
    expect(readWorkbook(z, { maxFormulaCells: 5 }).coverage.formulaCells).toBe(5);

    const two = buildXlsx({
      sheets: [
        { name: 'A', rows: row(1, fml('A1', '1') + fml('B1', '2') + fml('C1', '3')) },
        { name: 'B', rows: row(1, fml('A1', '1') + fml('B1', '2') + fml('C1', '3')) },
      ],
    });
    expect(code(() => readWorkbook(two, { maxFormulaCells: 5 }))).toBe('too-many-formulas');
    expect(readWorkbook(two, { maxFormulaCells: 6 }).coverage.formulaCells).toBe(6);
  });
});

describe('limits', () => {
  it('resolves overrides onto the defaults and refuses nonsense', () => {
    expect(resolveLimits({ maxSheets: 3 })).toMatchObject({ maxSheets: 3, maxParts: 2000, maxFormulaCells: 50_000 });
    expect(() => resolveLimits({ maxParts: 0 })).toThrow(RangeError);
    expect(() => resolveLimits({ maxParts: 1.5 })).toThrow(RangeError);
  });
});

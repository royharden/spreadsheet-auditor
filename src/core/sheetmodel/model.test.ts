import { describe, expect, it } from 'vitest';
import { cellAt, findSheet, isFormulaCell, isMergedNonAnchor, readWorkbook } from './model.ts';
import { REL_TYPE, buildXlsx, fml, num, row, singleSheet, sst, stylesXml } from './testkit.ts';
import type { Sheet } from './types.ts';

function sheetOf(bytes: Uint8Array, index = 0): Sheet {
  return readWorkbook(bytes).sheets[index];
}

describe('readWorkbook: cached values and types', () => {
  const bytes = singleSheet(
    row(
      1,
      num('A1', 10) +
        sst('B1', 0) +
        '<c r="C1" t="b"><v>1</v></c>' +
        '<c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c>' +
        '<c r="E1"><f>A1*2</f></c>' +
        '<c r="F1" t="str"><f>"x"&amp;"y"</f><v>xy</v></c>' +
        '<c r="G1" t="inlineStr"><is><t>inline</t></is></c>' +
        '<c r="H1" t="e"><v>#REF!</v></c>' +
        '<c r="I1" t="b"><f>A1&gt;5</f><v>0</v></c>' +
        '<c r="J1" s="0"/>',
    ),
    { sharedStrings: ['Revenue'] },
  );
  const sheet = sheetOf(bytes);
  const get = (a1: string) => sheet.cells.get(a1);

  it('reads numbers, shared strings, booleans, inline strings and formula strings', () => {
    expect(get('A1')).toMatchObject({ cachedType: 'n', cachedValue: 10, row: 1, col: 1, addr: 'A1' });
    expect(get('B1')).toMatchObject({ cachedType: 's', cachedValue: 'Revenue' });
    expect(get('C1')).toMatchObject({ cachedType: 'b', cachedValue: true });
    expect(get('F1')).toMatchObject({ cachedType: 'str', cachedValue: 'xy', formula: '"x"&"y"', formulaKind: 'normal' });
    expect(get('G1')).toMatchObject({ cachedType: 'inlineStr', cachedValue: 'inline' });
    expect(get('I1')).toMatchObject({ cachedType: 'b', cachedValue: false, formula: 'A1>5' });
  });

  it('reads cached errors as type e, with and without a formula', () => {
    expect(get('D1')).toMatchObject({ cachedType: 'e', cachedValue: '#DIV/0!', formula: '1/0' });
    expect(get('H1')).toMatchObject({ cachedType: 'e', cachedValue: '#REF!' });
    expect(get('H1')?.formula).toBeUndefined();
  });

  it('treats a missing cache as unknown (none/null), never zero, and says so', () => {
    expect(get('E1')).toMatchObject({ cachedType: 'none', cachedValue: null, formula: 'A1*2' });
    const model = readWorkbook(bytes);
    expect(model.coverage.notes.some((n) => n.includes('no cached value'))).toBe(true);
  });

  it('omits style-only placeholder cells', () => {
    expect(get('J1')).toBeUndefined();
  });

  it('counts formula cells and computes extents', () => {
    const model = readWorkbook(bytes);
    expect(model.coverage.formulaCells).toBe(4);
    expect(sheet.maxRow).toBe(1);
    expect(sheet.maxCol).toBe(9);
    expect(isFormulaCell(get('D1')!)).toBe(true);
    expect(isFormulaCell(get('A1')!)).toBe(false);
  });

  it('stores the R1C1 form of every formula', () => {
    expect(get('E1')?.r1c1).toBe('RC[-4]*2');
    expect(get('D1')?.r1c1).toBe('1/0');
  });
});

describe('readWorkbook: addresses', () => {
  it('infers missing r attributes from position', () => {
    const sheet = sheetOf(singleSheet('<row><c><v>1</v></c><c><v>2</v></c></row><row><c r="C2"><v>3</v></c><c><v>4</v></c></row>'));
    expect([...sheet.cells.keys()].sort()).toEqual(['A1', 'B1', 'C2', 'D2']);
    expect(sheet.cells.get('D2')?.cachedValue).toBe(4);
  });

  it('provides lookup helpers', () => {
    const model = readWorkbook(singleSheet(row(3, num('B3', 7))));
    const sheet = findSheet(model, 'sheet1');
    expect(sheet?.name).toBe('Sheet1');
    expect(cellAt(sheet!, 3, 2)?.cachedValue).toBe(7);
    expect(cellAt(sheet!, 0, 2)).toBeUndefined();
    expect(cellAt(sheet!, 3, 99_999)).toBeUndefined();
  });
});

describe('readWorkbook: duplicate cell addresses', () => {
  // Regression (M1 review #1): the earlier cell stayed in the formula/array/shared work lists.
  it('keeps only the later cell and leaves no ghost formula, array membership or budget use', () => {
    const bytes = singleSheet(
      row(1, fml('A1', 'B1*2', 2) + num('A1', 5) + num('B1', 1)) +
        row(2, '<c r="C2"><f t="array" ref="C2:C3">B1:B2</f><v>1</v></c>' + num('C2', 9)) +
        row(3, num('C3', 2)),
    );
    const model = readWorkbook(bytes);
    const sheet = model.sheets[0];
    expect(sheet.cells.get('A1')).toMatchObject({ cachedType: 'n', cachedValue: 5 });
    expect(sheet.cells.get('A1')?.formula).toBeUndefined();
    expect(sheet.cells.get('C2')?.formula).toBeUndefined();
    expect(sheet.cells.get('C3')?.inArray).toBeUndefined();
    expect(model.coverage.formulaCells).toBe(0);
    expect(model.coverage.notes.some((n) => n.includes('appears twice'))).toBe(true);
  });

  it('does not count a replaced formula against the formula cap', () => {
    const bytes = singleSheet(row(1, fml('A1', 'B1*2', 2) + fml('A1', 'B1*3', 3) + num('B1', 1)));
    const model = readWorkbook(bytes, { maxFormulaCells: 1 });
    expect(model.coverage.formulaCells).toBe(1);
    expect(model.sheets[0].cells.get('A1')).toMatchObject({ formula: 'B1*3', cachedValue: 3 });
  });

  it('drops a replaced shared-formula master so children cannot expand from a ghost', () => {
    const bytes = singleSheet(
      row(1, '<c r="A1"><f t="shared" si="0" ref="A1:A2">B1*2</f><v>2</v></c>' + num('A1', 7) + num('B1', 1)) +
        row(2, '<c r="A2"><f t="shared" si="0"/><v>4</v></c>' + num('B2', 2)),
    );
    const sheet = readWorkbook(bytes).sheets[0];
    expect(sheet.cells.get('A2')).toMatchObject({ formulaKind: 'shared', opaque: ['unresolved-shared'] });
    expect(sheet.cells.get('A2')?.formula).toBeUndefined();
  });
});

describe('readWorkbook: sheet-prefix case in R1C1', () => {
  it("gives 'DATA'!B2 and Data!B2 the same R1C1 form (workbook spelling)", () => {
    const model = readWorkbook(
      buildXlsx({
        sheets: [
          { name: 'Data', rows: row(2, num('B2', 1)) + row(3, num('B3', 2)) },
          { name: 'Calc', rows: row(1, fml('A1', "'DATA'!B2*2", 2)) + row(2, fml('A2', 'data!B3*2', 4)) },
        ],
      }),
    );
    const calc = model.sheets[1];
    expect(calc.cells.get('A1')?.r1c1).toBe("'Data'!R[1]C[1]*2");
    expect(calc.cells.get('A2')?.r1c1).toBe(calc.cells.get('A1')?.r1c1);
  });
});

describe('readWorkbook: styles, percent and date detection', () => {
  const styles = stylesXml({ 164: '0.0%', 165: 'yyyy-mm-dd' }, [0, 9, 14, 164, 165]);
  const sheet = sheetOf(
    singleSheet(row(1, num('A1', 5) + num('B1', 0.05, 1) + num('C1', 45000, 2) + num('D1', 0.5, 3) + num('E1', 45001, 4)), {
      stylesXml: styles,
    }),
  );

  it('flags percent formats (built-in and custom)', () => {
    expect(sheet.cells.get('A1')).toMatchObject({ isPercentFmt: false, isDateFmt: false, numFmtId: 0 });
    expect(sheet.cells.get('B1')).toMatchObject({ isPercentFmt: true, numFmtId: 9, styleId: 1, numFmtCode: '0%' });
    expect(sheet.cells.get('D1')).toMatchObject({ isPercentFmt: true, numFmtId: 164, numFmtCode: '0.0%' });
  });

  it('flags date formats (built-in and custom)', () => {
    expect(sheet.cells.get('C1')).toMatchObject({ isDateFmt: true, numFmtId: 14 });
    expect(sheet.cells.get('E1')).toMatchObject({ isDateFmt: true, numFmtId: 165, isPercentFmt: false });
  });
});

describe('readWorkbook: merges, hidden sheets, defined names, external links', () => {
  const bytes = buildXlsx({
    sheets: [
      {
        name: 'Budget',
        rows: row(1, sst('A1', 0)) + row(2, num('B2', 1)),
        after: '<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="D4:E6"/></mergeCells>',
      },
      { name: 'Lookups', rows: row(1, num('A1', 0.2)), state: 'hidden' },
      { name: 'Secret', rows: '', state: 'veryHidden' },
    ],
    sharedStrings: ['Q3 budget'],
    workbookAfterSheets:
      '<externalReferences><externalReference r:id="rId90"/></externalReferences>' +
      '<definedNames>' +
      '<definedName name="TaxRate">Lookups!$A$1</definedName>' +
      '<definedName name="LocalTotal" localSheetId="0">Budget!$B$2</definedName>' +
      '<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">Lookups!$A$1:$A$5</definedName>' +
      '</definedNames>',
    workbookRels: `<Relationship Id="rId90" Type="${REL_TYPE('externalLink')}" Target="externalLinks/externalLink1.xml"/>`,
    extraParts: {
      'xl/externalLinks/externalLink1.xml':
        '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"/></externalLink>',
      'xl/externalLinks/_rels/externalLink1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_TYPE(
        'externalLinkPath',
      )}" Target="file:///C:/Finance/Rates.xlsx" TargetMode="External"/></Relationships>`,
    },
  });
  const model = readWorkbook(bytes);

  it('lists merged ranges', () => {
    expect(model.sheets[0].merges).toEqual([
      { start: { row: 1, col: 1 }, end: { row: 1, col: 3 } },
      { start: { row: 4, col: 4 }, end: { row: 6, col: 5 } },
    ]);
    expect(isMergedNonAnchor(model.sheets[0], 1, 1)).toBe(false);
    expect(isMergedNonAnchor(model.sheets[0], 1, 2)).toBe(true);
    expect(isMergedNonAnchor(model.sheets[0], 2, 2)).toBe(false);
  });

  it('records sheet visibility', () => {
    expect(model.sheets.map((s) => [s.name, s.index, s.hidden, s.state])).toEqual([
      ['Budget', 0, false, 'visible'],
      ['Lookups', 1, true, 'hidden'],
      ['Secret', 2, true, 'veryHidden'],
    ]);
  });

  it('reads defined names with their scope', () => {
    expect(model.definedNames).toEqual([
      { name: 'TaxRate', formula: 'Lookups!$A$1', hidden: false },
      { name: 'LocalTotal', formula: 'Budget!$B$2', hidden: false, localSheetId: 0, scopeSheet: 'Budget' },
      { name: '_xlnm._FilterDatabase', formula: 'Lookups!$A$1:$A$5', hidden: true, localSheetId: 1, scopeSheet: 'Lookups' },
    ]);
  });

  it('lists external links by target without following them', () => {
    expect(model.externalLinks).toEqual(['file:///C:/Finance/Rates.xlsx']);
    expect(model.coverage.notes.some((n) => n.includes('never opened'))).toBe(true);
  });

  it('leaves skippedRules for the rules engine', () => {
    expect(model.coverage.skippedRules).toEqual([]);
  });
});

describe('readWorkbook: coverage of opaque formulas', () => {
  it('lists opaque categories per formula cell with canonical CellRefs', () => {
    const model = readWorkbook(
      buildXlsx({
        sheets: [
          {
            name: "O'Brien",
            rows: row(
              1,
              fml('A1', 'SUM(Table1[Amount])') +
                fml('B1', 'SUM(Jan:Mar!B2)') +
                fml('C1', '[1]Rates!$A$1*2') +
                fml('D1', 'SUM(A:A)') +
                fml('E1', 'SUM(2:2)') +
                fml('F1', 'A2+B2'),
            ),
          },
        ],
      }),
    );
    expect(model.coverage.opaque).toEqual([
      { cell: "'O''Brien'!A1", category: 'structured-ref' },
      { cell: "'O''Brien'!B1", category: '3d-ref' },
      { cell: "'O''Brien'!C1", category: 'external-ref' },
      { cell: "'O''Brien'!D1", category: 'whole-column' },
      { cell: "'O''Brien'!E1", category: 'whole-row' },
    ]);
    expect(model.sheets[0].cells.get('F1')?.opaque).toBeUndefined();
    expect(model.sheets[0].cells.get('A1')?.opaque).toEqual(['structured-ref']);
  });

  it('treats data-table cells as opaque formula cells', () => {
    const model = readWorkbook(singleSheet(row(2, '<c r="B2"><f t="dataTable" ref="B2:C3" dt2D="0" dtr="0" r1="A1"/><v>5</v></c>')));
    const cell = model.sheets[0].cells.get('B2');
    expect(cell).toMatchObject({ formulaKind: 'dataTable', cachedValue: 5, opaque: ['data-table'] });
    expect(cell?.formula).toBeUndefined();
    expect(isFormulaCell(cell!)).toBe(true);
  });
});

describe('readWorkbook: non-worksheet sheets', () => {
  it('notes a chartsheet instead of analysing it, keeping workbook positions', () => {
    const model = readWorkbook(
      buildXlsx({
        sheets: [
          { name: 'Data', rows: row(1, num('A1', 1)) },
          { name: 'Chart1', chart: true },
          { name: 'More', rows: row(1, num('A1', 2)) },
        ],
      }),
    );
    expect(model.sheets.map((s) => [s.name, s.index])).toEqual([
      ['Data', 0],
      ['More', 2],
    ]);
    expect(model.coverage.notes.some((n) => n.includes('"Chart1"') && n.includes('chartsheet'))).toBe(true);
  });
});

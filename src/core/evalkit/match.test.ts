import { describe, expect, it } from 'vitest';
import { normalizeLocation, parseManifest, type Detection, type ManifestRow } from './manifest.ts';
import { matchDetections } from './match.ts';

function row(cell: string, primaryRule: ManifestRow['primaryRule'], truth: ManifestRow['truth'] = 'defect', also_ok_rules: ManifestRow['also_ok_rules'] = []): ManifestRow {
  return { workbook: 'dev/book.xlsx', sheet: "O'Brien", cell, primaryRule, truth, role: truth === 'defect' ? 'primary' : truth === 'by_design' ? 'by_design' : 'propagated', denominatorEligible: truth === 'defect', also_ok_rules };
}
function hit(cell: string, ruleId: Detection['ruleId']): Detection { return { workbook: 'dev/book.xlsx', sheet: "O'Brien", cell, ruleId }; }

describe('label-based one-credit matching', () => {
  it('gives primary truth precedence, keeps the secondary broken/error hit neutral, and dedupes canonical identities', () => {
    const manifest = [row('B2', 'BROKEN_REF', 'defect', ['ERROR_VALUE', 'BROKEN_REF'])];
    const hits = [hit('B2', 'ERROR_VALUE'), hit('B2', 'BROKEN_REF'), { ...hit("'O''BRIEN'!$b$2", 'BROKEN_REF'), workbook: '.\\DEV\\BOOK.XLSX', sheet: "O'BRIEN" }];
    const result = matchDetections(manifest, hits);
    expect(result.byRule.BROKEN_REF).toEqual({ tp: 1, fp: 0, fn: 0, neutral: 0, rawDetections: 1 });
    expect(result.byRule.ERROR_VALUE).toEqual({ tp: 0, fp: 0, fn: 0, neutral: 1, rawDetections: 1 });
    expect(result).toMatchObject({ submitted: 3, deduped: 2, duplicates: 1 });
    expect(result.falseNegatives).toEqual([]);
  });

  it('a secondary hit cannot hide an FN for the absent primary rule', () => {
    const result = matchDetections([row('B2', 'BROKEN_REF', 'defect', ['ERROR_VALUE'])], [hit('B2', 'ERROR_VALUE')]);
    expect(result.byRule.BROKEN_REF.fn).toBe(1);
    expect(result.byRule.ERROR_VALUE.neutral).toBe(1);
  });

  it('present propagated hits are neutral; absent propagated hits never add an FN', () => {
    const manifest = [row('B2', 'ERROR_VALUE'), row('B3', null, 'neutral', ['ERROR_VALUE'])];
    expect(matchDetections(manifest, [hit('B2', 'ERROR_VALUE'), hit('B3', 'ERROR_VALUE')]).byRule.ERROR_VALUE).toMatchObject({ tp: 1, neutral: 1, fn: 0, rawDetections: 2 });
    expect(matchDetections(manifest, [hit('B2', 'ERROR_VALUE')]).byRule.ERROR_VALUE).toMatchObject({ tp: 1, neutral: 0, fn: 0 });
    expect(matchDetections(manifest, []).falseNegatives.map((item) => item.cell)).toEqual(['B2']);
  });

  it('counts by-design, wrong-rule and unlabelled hits as FP and only eligible defects as FN', () => {
    const excluded = { ...row('B4', 'SUM_RANGE_SHORT'), denominatorEligible: false };
    const manifest = [row('B2', 'CONSTANT_PLUG', 'by_design'), row('B3', 'FORMULA_DRIFT'), excluded];
    const result = matchDetections(manifest, [hit('B2', 'CONSTANT_PLUG'), hit('B3', 'MIXED_UNITS'), hit('Z9', 'ERROR_VALUE')]);
    expect(result.matches.map((match) => match.outcome)).toEqual(['FP', 'FP', 'FP']);
    expect(result.falseNegatives.map((item) => item.cell)).toEqual(['B3']);
  });

  it('rejects ambiguous duplicate oracle rows and conflicting/invalid cell identity', () => {
    expect(() => parseManifest([row('B2', 'ERROR_VALUE'), row('$b$2', 'BROKEN_REF')])).toThrow('Duplicate');
    expect(() => normalizeLocation({ workbook: '../book.xlsx', sheet: 'S', cell: 'A1' })).toThrow();
    expect(() => normalizeLocation({ workbook: 'book.xlsx', sheet: 'S', cell: 'Other!A1' })).toThrow();
    expect(() => parseManifest([{ ...row('B2', null, 'neutral'), denominatorEligible: true }])).toThrow();
  });
});

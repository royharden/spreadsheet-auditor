import { describe, expect, it } from 'vitest';
import { runAudit } from '../audit.ts';
import { readWorkbook } from '../sheetmodel/model.ts';
import { fml, num, row, singleSheet } from '../sheetmodel/testkit.ts';
import { sumWorkbook } from './m3Fixtures.ts';
import { applySumRangeShort, singleSumRange } from './sumRangeShort.ts';

describe('SUM_RANGE_SHORT', () => {
  it('extends a vertical range through the numeric continuation', () => {
    const found = applySumRangeShort(readWorkbook(sumWorkbook()), { note: () => undefined });
    expect(found).toMatchObject([{ cell: 'B12', facts: { range_ends_at: "'Sheet1'!B9", data_continues_to: "'Sheet1'!B11", rows_omitted: 2 }, fix: { kind: 'formula', value: '=SUM(B2:B11)' } }]);
  });
  it('counts numeric cached formula cells and supports a horizontal range', () => {
    expect(applySumRangeShort(readWorkbook(sumWorkbook('formula')), { note: () => undefined })).toHaveLength(1);
    const horizontal = singleSheet(row(2, num('B2', 2) + num('C2', 3) + num('D2', 4) + num('E2', 5) + fml('F2', 'SUM(B2:D2)', 9)));
    expect(applySumRangeShort(readWorkbook(horizontal), { note: () => undefined })).toMatchObject([{ cell: 'F2', facts: { axis: 'row', rows_omitted: 1 }, fix: { value: '=SUM(B2:E2)' } }]);
  });
  it('abstains at blank/text/subtotal cells and reports unknown caches', () => {
    for (const stop of ['blank', 'text', 'subtotal', 'missing'] as const) {
      const notes: string[] = [];
      expect(applySumRangeShort(readWorkbook(sumWorkbook(stop)), { note: (note) => notes.push(note) })).toEqual([]);
      expect(notes.length).toBe(stop === 'missing' ? 1 : 0);
    }
  });
  it('accepts whitespace and same-sheet qualifiers, but rejects unsupported formula shapes', () => {
    expect(singleSumRange('= SUM ( $B$2:$B$9 ) ', 'Sheet1')).not.toBeNull();
    expect(singleSumRange("SUM('SHEET1'!B2:B9)", 'Sheet1')).not.toBeNull();
    for (const formula of ['SUM(Other!B2:B9)', 'SUM(B2:B9)+1', 'SUM(B2:B9,B11)', 'SUM(B2:C9)', 'SUBTOTAL(9,B2:B9)']) {
      expect(singleSumRange(formula, 'Sheet1')).toBeNull();
    }
  });
  it('never cites the distant range start; a distant end is omitted too', () => {
    for (const end of [9, 2]) {
      const finding = runAudit(sumWorkbook('numeric', end)).findings.find((f) => f.ruleId === 'SUM_RANGE_SHORT')!;
      expect(finding.fix.value).toBe('=SUM(B2:B11)');
      expect(finding.explanation.explanation).not.toMatch(/\bB2\b/);
      expect(finding.explanation.cited_cells).not.toContain("'Sheet1'!B2");
      expect(finding.explanation.checker.ok).toBe(true);
    }
  });
});

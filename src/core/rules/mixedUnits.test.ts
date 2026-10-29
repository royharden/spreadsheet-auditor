import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { buildXlsx, fml, num, row, singleSheet } from '../sheetmodel/testkit.ts';
import { txt } from '../testFixtures.ts';
import { additionWorkbook, percentTieWorkbook, percentWorkbook } from './m3Fixtures.ts';
import { applyMixedUnits } from './mixedUnits.ts';
import { unitOfHeader } from './units.ts';

function run(bytes: Uint8Array) {
  const notes: string[] = [];
  return { findings: applyMixedUnits(readWorkbook(bytes), { note: (note) => notes.push(note) }), notes };
}
describe('MIXED_UNITS', () => {
  it('classifies formula caches like constants and flags only minority scale cells', () => {
    expect(run(percentWorkbook()).findings).toMatchObject([{ cell: 'A4', facts: { class_name: 'whole', majority_class: 'fraction' }, tier: 'review', fix: { kind: 'text' } }]);
    const clean = singleSheet(row(1, txt('A1', 'Rate')) + row(2, num('A2', 0.05)) + row(3, num('A3', 0.1)));
    expect(run(clean).findings).toEqual([]);
  });
  it('breaks ties percent then fraction then whole and ignores dates/nonpositive values', () => {
    expect(run(percentTieWorkbook()).findings.map((f) => f.cell)).toEqual(['A3', 'A4']);
    const fractionTie = singleSheet(row(1, txt('A1', 'Rate')) + row(2, num('A2', 0.05)) + row(3, num('A3', 5)));
    expect(run(fractionTie).findings.map((f) => f.cell)).toEqual(['A3']);
  });
  it('stops at text or two blanks, tolerates a single blank and notes missing caches', () => {
    for (const separator of ['text', 'two-blanks', 'one-blank'] as const) {
      const data = row(1, txt('A1', 'Rate')) + row(2, num('A2', 0.05)) + row(3, num('A3', 0.1)) +
        (separator === 'text' ? row(4, txt('A4', 'Next section')) : '') + row(separator === 'two-blanks' ? 6 : 5, num(separator === 'two-blanks' ? 'A6' : 'A5', 5));
      expect(run(singleSheet(data)).findings.length).toBe(separator === 'one-blank' ? 1 : 0);
    }
    const missing = singleSheet(row(1, txt('A1', 'Rate')) + row(2, fml('A2', '1/20')) + row(3, num('A3', 0.05)) + row(4, num('A4', 5)));
    expect(run(missing).notes[0]).toContain('no cached value');
  });
  it('uses the longest overlapping token and canonicalises equivalent unit aliases', () => {
    expect(unitOfHeader('Revenue $000')).toBe('$000');
    expect(unitOfHeader('Revenue $M')).toBe('$M');
    expect(unitOfHeader('Revenue $K')).toBe('$000');
    expect(unitOfHeader('Revenue (000s)')).toBe('$000');
    expect(unitOfHeader('Work hrs')).toBe('hours');
    expect(unitOfHeader('$000 and units')).toBeNull();
    expect(unitOfHeader('$000 and $')).toBeNull();
  });
  it('keeps the $000 + $000 named trap benign, but flags $000 + $', () => {
    expect(run(additionWorkbook('Revenue $000', 'Cost $000')).findings).toEqual([]);
    expect(run(additionWorkbook('Revenue $K', 'Cost (000s)')).findings).toEqual([]);
    expect(run(additionWorkbook()).findings).toMatchObject([{ cell: 'C2', facts: { unit_case: 'formula-addition', unit_tokens: ['$000', '$'] } }]);
  });
  it('abstains for ambiguous/unknown headers and non-addition expressions', () => {
    expect(run(additionWorkbook('$000 and units', 'Cost $')).findings).toEqual([]);
    expect(run(additionWorkbook('Amount', 'Cost $')).findings).toEqual([]);
    for (const formula of ['A2*B2', 'A2+B2+1', 'SUM(A2:B2)', '-A2+B2']) {
      expect(run(additionWorkbook('Revenue $000', 'Cost $', formula)).findings).toEqual([]);
    }
  });
  it('resolves nearest headers across sheets and supports subtraction', () => {
    const bytes = buildXlsx({ sheets: [
      { name: 'Left', rows: row(1, txt('A1', 'Revenue $000')) + row(2, num('A2', 10)) },
      { name: 'Right', rows: row(1, txt('A1', 'Cost $')) + row(2, num('A2', 20)) },
      { name: 'Calc', rows: row(2, fml('C2', 'Left!A2-Right!A2', -10)) },
    ] });
    expect(run(bytes).findings).toMatchObject([{ sheet: 'Calc', cell: 'C2', facts: { unit_tokens: ['$000', '$'] } }]);
  });
});

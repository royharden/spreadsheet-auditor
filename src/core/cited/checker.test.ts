import { describe, expect, it } from 'vitest';
import type { Bundle } from '../evidence/bundle.ts';
import { checkExplanation } from './checker.ts';

const evidence: Bundle = {
  findingId: 'test', sha256: '0'.repeat(64), labels: { col: 'Rate %' }, facts: { omitted: 2 },
  cells: { "'Data'!A1": { t: 'n', v: 0.05 }, "'Data'!A3": { t: 'n', v: 1234.5 }, "'O''Brien 2024'!B2": { t: 'n', v: -1234.5 } },
};
const check = (explanation: string, cited_cells: string[] = ["'Data'!A1"]) => checkExplanation({ explanation, cited_cells }, evidence, { sheet: 'Data' });

describe('citation checker', () => {
  it('accepts valid local, anchored and case-folded references', () => {
    expect(check('A1 has value 0.05.').ok).toBe(true);
    expect(check('$A$1 has value 5%.', ['data!$A$1']).ok).toBe(true);
  });
  it('accepts fraction/percent equivalents and exact currency values', () => {
    expect(check('A1 is 5%.').ok).toBe(true);
    expect(check('A3 contains $1,234.50.', ["'Data'!A3"]).ok).toBe(true);
    expect(check("'O''Brien 2024'!B2 contains -1,234.50.", ["'O''Brien 2024'!B2"]).ok).toBe(true);
  });
  it('ignores address and quoted-sheet digits when checking numbers', () => {
    expect(check("'O''Brien 2024'!B2 is referenced.", ["'O''Brien 2024'!B2"]).ok).toBe(true);
  });
  it('rejects an unknown or out-of-bounds address-like reference', () => {
    expect(check('XFE1 is incorrect.', ['XFE1']).ok).toBe(false);
    expect(check('A0 is incorrect.', ['A0']).failures.some((f) => f.code === 'unparseable-address')).toBe(true);
  });
  it('rejects valid addresses outside the bundle', () => {
    expect(check('A9 is wrong.', ['A9']).failures.some((f) => f.code === 'cited-outside-bundle')).toBe(true);
    expect(check('Other!A1 is wrong.', ['Other!A1']).ok).toBe(false);
  });
  it('rejects invented and rounded numbers, even a close rounding', () => {
    expect(check('A1 contains 77.').ok).toBe(false);
    expect(check('A3 contains 1235.', ['A3']).ok).toBe(false);
    expect(check('A1 contains 0.05000000000001.').ok).toBe(false);
  });
  it('accepts grounded complete scientific notation, including signs and percent conversion', () => {
    expect(check('A1 contains 5e-2.').ok).toBe(true);
    expect(check('A1 contains +5E+0%.').ok).toBe(true);
    expect(check('A3 contains $1.2345e3.', ['A3']).ok).toBe(true);
    expect(check("'O''Brien 2024'!B2 contains -1.2345e3.", ["'O''Brien 2024'!B2"]).ok).toBe(true);
  });
  it.each(['1e9', '1E+9', '1e-9', '-1e9', '1e9%', '1e', '1e+', '1e9.5', '1e9tail'])(
    'rejects %s instead of grounding only its mantissa in ref_error_count', (claim) => {
      const countEvidence: Bundle = {
        findingId: 'ref-count', sha256: '0'.repeat(64), labels: {}, facts: { ref_error_count: 1 },
        cells: { "'Data'!A2": { t: 'e', v: '#REF!' } },
      };
      const result = checkExplanation({ explanation: `A2 contains ${claim}.`, cited_cells: ['A2'] }, countEvidence, { sheet: 'Data' });
      expect(result.ok).toBe(false);
      expect(result.failures.some((f) => f.code === 'ungrounded-number')).toBe(true);
    },
  );
  it('grounds the complete exponent value in evidence text rather than its mantissa', () => {
    const textEvidence: Bundle = {
      findingId: 'exponent-text', sha256: '0'.repeat(64), labels: { col: 'Magnitude 1e9' }, facts: {},
      cells: { "'Data'!A2": { t: 'e', v: '#REF!' } },
    };
    expect(checkExplanation({ explanation: 'A2 contains 1000000000.', cited_cells: ['A2'] }, textEvidence, { sheet: 'Data' }).ok).toBe(true);
    expect(checkExplanation({ explanation: 'A2 contains 1.', cited_cells: ['A2'] }, textEvidence, { sheet: 'Data' }).ok).toBe(false);
  });
  it.each(['1e999', '-1e999', '9'.repeat(400), 'Infinity', '-Infinity', 'NaN', '∞'])(
    'rejects a nonfinite numeric claim even when evidence contains nonfinite values: %s', (claim) => {
      const nonfiniteEvidence: Bundle = {
        findingId: 'nonfinite', sha256: '0'.repeat(64), labels: { col: 'Magnitude 1e999' }, facts: { magnitude: Infinity },
        cells: { "'Data'!A2": { t: 'n', v: Infinity } },
      };
      const result = checkExplanation({ explanation: `A2 contains ${claim}.`, cited_cells: ['A2'] }, nonfiniteEvidence, { sheet: 'Data' });
      expect(result.ok).toBe(false);
      expect(result.failures.some((f) => f.code === 'ungrounded-number')).toBe(true);
    },
  );
  it('rejects spelled-out numbers, including inside grounded quoted text', () => {
    expect(check('A1 has two missing entries.').failures.some((f) => f.code === 'number-word')).toBe(true);
    const quoted = { ...evidence, labels: { col: 'two entries' } };
    expect(checkExplanation({ explanation: 'A1 has "two entries".', cited_cells: ['A1'] }, quoted, { sheet: 'Data' }).ok).toBe(false);
  });
  it('requires both range endpoints and exact prose/cited set equality', () => {
    expect(check('A1:A3 form the range.', ['A1', 'A3']).ok).toBe(true);
    expect(check('A1:A3 form the range.', ['A1']).ok).toBe(false);
    expect(check('A1 is wrong.', ['A1', 'A3']).ok).toBe(false);
    expect(check('A1 is wrong.', []).ok).toBe(false);
    expect(check('A1:A9 form the range.', ['A1', 'A9']).ok).toBe(false);
  });
  it('rejects external and 3-D references instead of treating their tail as local A1', () => {
    expect(check('[1]Data!A1 is wrong.').ok).toBe(false);
    expect(check('Data:Other!A1 is wrong.').ok).toBe(false);
  });
  it('does not hide address claims inside a verbatim cell-text quote', () => {
    const quoted = { ...evidence, labels: { col: 'A9 is wrong' } };
    expect(checkExplanation({ explanation: 'A1 says "A9 is wrong".', cited_cells: ['A1'] }, quoted, { sheet: 'Data' }).ok).toBe(false);
  });
  it('does not ground a number merely because it appears in a formula', () => {
    const formulaOnly = { ...evidence, cells: { "'Data'!A1": { t: 'n' as const, v: 0.05, f: '=700+1' } } };
    expect(checkExplanation({ explanation: 'A1 contains 700.', cited_cells: ['A1'] }, formulaOnly, { sheet: 'Data' }).ok).toBe(false);
  });
});

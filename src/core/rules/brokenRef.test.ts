import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { fml, row, singleSheet } from '../sheetmodel/testkit.ts';
import { cleanWorkbook, errorsWorkbook } from '../testFixtures.ts';
import { applyBrokenRef } from './brokenRef.ts';
import { runRules, RULES } from './registry.ts';
import { RULE_IDS, RULE_META } from './types.ts';

describe('BROKEN_REF and rule registry', () => {
  it('finds bare and sheet-qualified error tokens, including repeated references', () => {
    const model = readWorkbook(singleSheet(row(1, fml('A1', "#REF!+'Old sheet'!#REF!", 4))));
    const found = applyBrokenRef(model, { note: () => undefined });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ruleId: 'BROKEN_REF', tier: 'confirmed', severity: 'high', facts: { ref_error_count: 2 }, fix: { kind: 'text' } });
  });

  it('ignores error-looking text inside formula strings (benign)', () => {
    expect(applyBrokenRef(readWorkbook(cleanWorkbook()), { note: () => undefined })).toEqual([]);
    const bytes = singleSheet(row(1, fml('A1', '"say ""#REF!"""', 'say "#REF!"', 'str')));
    expect(applyBrokenRef(readWorkbook(bytes), { note: () => undefined })).toEqual([]);
  });

  it('keeps ERROR_VALUE and BROKEN_REF overlap as distinct findings', () => {
    const found = runRules(readWorkbook(errorsWorkbook())).findings.filter((f) => f.sheet === 'Budget' && f.cell === 'B7');
    expect(found.map((f) => f.ruleId)).toEqual(['ERROR_VALUE', 'BROKEN_REF']);
    expect(new Set(found.map((f) => f.id)).size).toBe(2);
  });

  it('registers all six implemented rules with their fixed tiers', () => {
    expect(RULES.map((r) => r.id)).toEqual(RULE_IDS);
    for (const r of RULES) expect(r).toMatchObject(RULE_META[r.id]);
    const run = runRules(readWorkbook(cleanWorkbook()));
    expect(run.skippedRules).toEqual([]);
    expect(RULES.every((rule) => rule.implemented)).toBe(true);
  });
});

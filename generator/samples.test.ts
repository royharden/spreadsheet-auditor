import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit.ts';
import { RULE_IDS } from '../src/core/rules/types.ts';
import { readWorkbook } from '../src/core/sheetmodel/index.ts';
import { sha256Hex } from '../src/core/util/sha256.ts';
import { SAMPLE_DRIFT_CELL, SAMPLE_TAX_RATE_CELL, budgetQ3Source, buildBudgetQ3 } from './samples.ts';

describe('budget-q3 browser samples', () => {
  it('v1 contains all six demo rules, grouped errors, a tax-rate trap, and verified explanations', () => {
    const bytes = buildBudgetQ3(1);
    expect(sha256Hex(bytes)).toBe(sha256Hex(buildBudgetQ3(1)));
    const audit = runAudit(bytes, { fileName: 'budget-q3.xlsx' });
    expect(audit.coverage.skippedRules).toEqual([]);
    for (const rule of RULE_IDS) expect(audit.findings.some((finding) => finding.ruleId === rule)).toBe(true);
    expect(audit.findings.some((finding) => finding.ruleId === 'ERROR_VALUE' && finding.displayGroup !== undefined)).toBe(true);
    expect(audit.findings.some((finding) => finding.ruleId === 'CONSTANT_PLUG' && finding.cell === SAMPLE_TAX_RATE_CELL)).toBe(true);
    expect(audit.findings.every((finding) => finding.explanation.checker.ok)).toBe(true);
    const sum = audit.findings.find((finding) => finding.ruleId === 'SUM_RANGE_SHORT' && finding.cell === 'B12');
    expect(sum?.fix).toEqual({ kind: 'formula', value: '=SUM(B2:B11)' });
    const cells = readWorkbook(bytes).sheets[0].cells;
    expect(cells.get('B12')?.formula).toBe('SUM(B2:B9)');
    expect(cells.get('B10')?.cachedType).toBe('n');
    expect(cells.get('B11')?.cachedType).toBe('n');
  });

  it('v2 changes only the drift formula/cache, retains its finding and changes its formula hash', () => {
    const one = budgetQ3Source(1).sheets[0].cells;
    const two = budgetQ3Source(2).sheets[0].cells;
    const changed = Object.keys(one).filter((addr) => JSON.stringify(one[addr]) !== JSON.stringify(two[addr]));
    expect(changed).toEqual([SAMPLE_DRIFT_CELL]);
    const first = runAudit(buildBudgetQ3(1));
    const second = runAudit(buildBudgetQ3(2));
    expect(first.workbook.sha256).not.toBe(second.workbook.sha256);
    const drift = (audit: typeof first) => audit.findings.find((finding) => finding.ruleId === 'FORMULA_DRIFT' && finding.cell === SAMPLE_DRIFT_CELL);
    expect(drift(first)).toBeDefined();
    expect(drift(second)).toBeDefined();
    expect(drift(first)?.formulaHash).not.toBe(drift(second)?.formulaHash);
    for (const rule of RULE_IDS) expect(second.findings.some((finding) => finding.ruleId === rule)).toBe(true);
    expect(second.findings.every((finding) => finding.explanation.checker.ok)).toBe(true);
  });
});

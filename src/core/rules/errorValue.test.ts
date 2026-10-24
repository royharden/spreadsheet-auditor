import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { cleanWorkbook, errorsWorkbook, quotedSheetsWorkbook } from '../testFixtures.ts';
import { applyErrorValue, listedError } from './errorValue.ts';
import { findingId } from './finding.ts';
import type { Finding, RuleContext } from './types.ts';

function run(bytes: Uint8Array): { findings: Finding[]; notes: string[] } {
  const notes: string[] = [];
  const ctx: RuleContext = { note: (t) => notes.push(t) };
  return { findings: applyErrorValue(readWorkbook(bytes), ctx), notes };
}

const at = (fs: Finding[], sheet: string, cell: string): Finding | undefined =>
  fs.find((f) => f.sheet === sheet && f.cell === cell);

describe('ERROR_VALUE', () => {
  const { findings, notes } = run(errorsWorkbook());

  it('reports every listed cached error, with and without a formula', () => {
    const budget = findings.filter((f) => f.sheet === 'Budget').map((f) => [f.cell, f.facts.error_value]);
    expect(budget).toEqual([
      ['B4', '#DIV/0!'],
      ['B5', '#DIV/0!'],
      ['B6', '#N/A'],
      ['B7', '#REF!'],
      ['B8', '#NAME?'],
      ['B9', '#VALUE!'],
      ['B10', '#REF!'],
    ]);
    expect(at(findings, 'Budget', 'B10')?.facts.has_formula).toBe(false);
    expect(at(findings, 'Budget', 'B4')?.facts.has_formula).toBe(true);
  });

  it('uses the constant tier/severity and the planned id', () => {
    for (const f of findings) {
      expect(f).toMatchObject({ ruleId: 'ERROR_VALUE', tier: 'confirmed', severity: 'high', modelEligible: true });
      expect(f.id).toBe(findingId('ERROR_VALUE', f.sheet, f.cell));
      expect(f.id).toMatch(/^[0-9a-f]{12}$/);
      expect(f.formulaHash).toMatch(/^v1:[0-9a-f]{64}$/);
    }
  });

  it('groups a propagated error under its direct error precedent, same sheet', () => {
    const root = at(findings, 'Budget', 'B4');
    const dependent = at(findings, 'Budget', 'B5');
    expect(root?.displayGroup).toBeUndefined();
    expect(dependent?.displayGroup).toBe(root?.id);
    expect(dependent?.facts).toMatchObject({ precedent_cell: "'Budget'!B4", precedent_error: '#DIV/0!' });
    expect(dependent?.message).toBe('Cached #DIV/0! (propagated from B4)');
  });

  it('groups across sheets, resolving the sheet prefix case-insensitively', () => {
    const root = at(findings, 'Budget', 'B4');
    expect(at(findings, 'Summary', 'A1')?.displayGroup).toBe(root?.id);
    expect(at(findings, 'Summary', 'A3')?.displayGroup).toBe(root?.id);
    expect(at(findings, 'Summary', 'A3')?.facts.precedent_cell).toBe("'Budget'!B4");
    expect(at(findings, 'Summary', 'A1')?.message).toBe("Cached #DIV/0! (propagated from 'Budget'!B4)");
  });

  it('does not suppress dependents (every error cell is its own finding)', () => {
    expect(findings.filter((f) => f.facts.error_value === '#DIV/0!')).toHaveLength(4); // B4, B5, Summary A1, A3
  });

  it('does not group under range members or under unlisted errors', () => {
    // Summary!A2 = SUM(Budget!B2:B3) is not an error; Summary!A4 depends on an unlisted #NUM!.
    expect(at(findings, 'Summary', 'A2')).toBeUndefined();
    expect(at(findings, 'Summary', 'A4')).toBeUndefined();
  });

  it('counts unlisted cached errors in a coverage note instead of reporting them', () => {
    expect(at(findings, 'Budget', 'B11')).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2 cell(s)');
  });

  it('gives code-generated text fixes', () => {
    expect(at(findings, 'Budget', 'B4')?.fix).toMatchObject({ kind: 'text' });
    expect(at(findings, 'Budget', 'B4')?.fix.value).toContain('#DIV/0!');
    expect(at(findings, 'Budget', 'B5')?.fix.value).toContain('Fix the error in B4 first');
    expect(at(findings, 'Budget', 'B10')?.fix.value).toContain('typed value');
  });

  it('handles quoted sheet names with digits and apostrophes', () => {
    const q = run(quotedSheetsWorkbook()).findings;
    const dep = at(q, "O'Brien Q3", 'B1');
    expect(dep?.facts.precedent_cell).toBe("'Data 2024'!A2");
    expect(dep?.displayGroup).toBe(findingId('ERROR_VALUE', 'Data 2024', 'A2'));
  });

  it('is silent on a clean workbook (benign)', () => {
    expect(run(cleanWorkbook())).toEqual({ findings: [], notes: [] });
  });

  it('normalises error literals and rejects others', () => {
    expect(listedError(' #div/0! ')).toBe('#DIV/0!');
    expect(listedError('#NUM!')).toBeNull();
    expect(listedError(7)).toBeNull();
  });
});

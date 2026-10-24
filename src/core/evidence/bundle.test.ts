import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../sheetmodel/model.ts';
import { buildXlsx, fml, num, row, singleSheet } from '../sheetmodel/testkit.ts';
import { newFinding } from '../rules/finding.ts';
import { runRules } from '../rules/registry.ts';
import { evidencePlanFor } from '../explain/templates.ts';
import { longTextWorkbook, errorsWorkbook } from '../testFixtures.ts';
import { canonicalJson, utf8ByteLength } from '../util/canonicalJson.ts';
import { BUNDLE_MAX_BYTES, buildEvidence, bundleByteLength, isBundle, verifyBundleHash } from './bundle.ts';
import { sanitizeText } from './sanitize.ts';

describe('bounded evidence', () => {
  it('includes at most four optional neighbours per side, with stable content and hash', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(i + 1, i === 7 ? fml('A8', '1/0', '#DIV/0!', 'e') : num(`A${i + 1}`, i + 1))).join('');
    const model = readWorkbook(singleSheet(rows));
    const finding = runRules(model).findings[0];
    const evidence = buildEvidence(model, finding, { axis: 'column', required: [] });
    expect(isBundle(evidence)).toBe(true);
    if (!isBundle(evidence)) return;
    expect(Object.keys(evidence.cells)).toEqual(["'Sheet1'!A8", "'Sheet1'!A7", "'Sheet1'!A9", "'Sheet1'!A6", "'Sheet1'!A10", "'Sheet1'!A5", "'Sheet1'!A11", "'Sheet1'!A4", "'Sheet1'!A12"]);
    expect(verifyBundleHash(evidence)).toBe(true);
    expect(bundleByteLength(evidence)).toBe(utf8ByteLength(canonicalJson(evidence)));
    expect(bundleByteLength(evidence)).toBeLessThanOrEqual(BUNDLE_MAX_BYTES);
    expect(buildEvidence(model, finding, { axis: 'column', required: [] })).toEqual(evidence);
  });

  it('reserves every template citation before adding optional neighbours', () => {
    const model = readWorkbook(errorsWorkbook());
    const finding = runRules(model).findings.find((f) => f.sheet === 'Summary' && f.cell === 'A1')!;
    const evidence = buildEvidence(model, finding, evidencePlanFor(finding));
    expect(isBundle(evidence)).toBe(true);
    if (!isBundle(evidence)) return;
    expect(evidence.cells["'Budget'!B4"]).toMatchObject({ t: 'e', v: '#DIV/0!', f: '=B2/B3' });
  });

  it('never truncates an oversized required cell; returns template-only evidence', () => {
    const model = readWorkbook(longTextWorkbook());
    const finding = runRules(model).findings.find((f) => f.cell === 'A2')!;
    const evidence = buildEvidence(model, finding, evidencePlanFor(finding));
    expect(evidence).toEqual({ findingId: finding.id, templateOnly: true, cells: { flagged: "'Data'!A2" }, facts: finding.facts });
    expect('sha256' in evidence).toBe(false);
  });

  it('omits a huge optional neighbour without truncation and stops that side', () => {
    const model = readWorkbook(longTextWorkbook());
    const finding = runRules(model).findings.find((f) => f.cell === 'C7')!;
    const evidence = buildEvidence(model, finding, evidencePlanFor(finding));
    expect(isBundle(evidence)).toBe(true);
    if (!isBundle(evidence)) return;
    expect(evidence.cells["'Data'!C6"].v).toBe(2);
    expect(evidence.cells["'Data'!C8"]).toBeUndefined();
    expect(evidence.cells["'Data'!C9"]).toBeUndefined();
    expect(bundleByteLength(evidence)).toBeLessThanOrEqual(BUNDLE_MAX_BYTES);
  });

  it('counts UTF-8 bytes, not characters, including required labels', () => {
    const bytes = buildXlsx({ sheets: [{ name: 'Data', rows: row(1, '<c r="A1" t="inlineStr"><is><t>' + '界'.repeat(700) + '</t></is></c>') + row(2, fml('A2', '#REF!', '#REF!', 'e')) }] });
    const model = readWorkbook(bytes);
    const finding = runRules(model).findings[0];
    expect(isBundle(buildEvidence(model, finding, evidencePlanFor(finding)))).toBe(false);
  });

  it('sanitises formulas, facts and labels while keeping the model unchanged', () => {
    const model = readWorkbook(singleSheet(row(1, num('A1', 1))));
    const cell = model.sheets[0].cells.get('A1')!;
    cell.formula = '1+\u200b2';
    const finding = newFinding({ ruleId: 'BROKEN_REF', sheet: 'Sheet1', cell, message: 'test', facts: { label: 'x\u202ey\nend' }, fix: { kind: 'text', value: 'inspect' } });
    const evidence = buildEvidence(model, finding, { axis: 'column', required: [] });
    expect(isBundle(evidence)).toBe(true);
    if (!isBundle(evidence)) return;
    expect(evidence.cells["'Sheet1'!A1"].f).toBe('=1+2');
    expect(evidence.facts.label).toBe('xy end');
    expect(cell.formula).toBe('1+\u200b2');
    expect(sanitizeText('a\u0000\u200b\u202eb\r\nc')).toBe('ab c');
  });
});

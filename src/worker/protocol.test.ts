import { describe, expect, it } from 'vitest';
import { fml, num, row, singleSheet } from '../core/sheetmodel/testkit.ts';
import { handleAuditRequest, isAuditRequest } from './protocol.ts';

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

describe('parse worker protocol', () => {
  it('recognises audit requests only', () => {
    expect(isAuditRequest({ type: 'audit', id: 1, fileName: 'a.xlsx', bytes: new ArrayBuffer(0) })).toBe(true);
    expect(isAuditRequest({ type: 'audit', id: '1', fileName: 'a.xlsx', bytes: new ArrayBuffer(0) })).toBe(false);
    expect(isAuditRequest({ type: 'audit', id: NaN, fileName: 'a.xlsx', bytes: new ArrayBuffer(0) })).toBe(false);
    expect(isAuditRequest({ type: 'other' })).toBe(false);
    expect(isAuditRequest(null)).toBe(false);
  });

  it('answers with the audit result for the same id, as plain cloneable JSON', () => {
    const bytes = singleSheet(row(1, num('A1', 0) + fml('B1', '1/A1', '#DIV/0!', 'e')));
    const res = handleAuditRequest({ type: 'audit', id: 7, fileName: 'budget.xlsx', bytes: bufferOf(bytes) });
    expect(res.type).toBe('audit-result');
    expect(res.id).toBe(7);
    expect(res.outcome.ok).toBe(true);
    if (!res.outcome.ok) return;
    expect(res.outcome.result.workbook.name).toBe('budget.xlsx');
    expect(res.outcome.result.findings.map((f) => f.ruleId)).toEqual(['ERROR_VALUE']);
    expect(structuredClone(res)).toEqual(res);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('answers a refused file with the named gate refusal', () => {
    const res = handleAuditRequest({ type: 'audit', id: 8, fileName: 'macro.xlsm', bytes: new ArrayBuffer(4) });
    expect(res.outcome).toMatchObject({ ok: false, refusal: { code: 'unsupported-extension' } });
  });
});

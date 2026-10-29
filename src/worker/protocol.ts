// Messages between the UI thread and the parse worker. The workbook bytes travel only from the
// UI thread to this worker (transferred ArrayBuffer); the reply is the plain-JSON AuditOutcome.

import { runAuditSafe, type AuditOutcome } from '../core/audit.ts';

export interface AuditRequest {
  type: 'audit';
  /** Correlates a reply with its request. */
  id: number;
  fileName: string;
  bytes: ArrayBuffer;
}

export interface AuditResponse {
  type: 'audit-result';
  id: number;
  outcome: AuditOutcome;
}

export function isAuditRequest(value: unknown): value is AuditRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<AuditRequest>;
  return v.type === 'audit' && Number.isSafeInteger(v.id) && typeof v.fileName === 'string' && v.bytes instanceof ArrayBuffer;
}

/** Pure request handler (the worker entry only wires it to postMessage; tested directly). */
export function handleAuditRequest(req: AuditRequest): AuditResponse {
  return { type: 'audit-result', id: req.id, outcome: runAuditSafe(new Uint8Array(req.bytes), { fileName: req.fileName }) };
}

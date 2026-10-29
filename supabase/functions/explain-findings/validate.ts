import { canonicalJson } from './_shared/canonicalJson.ts';
import { MAX_BUNDLES, MAX_BUNDLE_BYTES, MAX_REQUEST_BYTES } from './_shared/limits.ts';
import type { PromptBundle, TriageArm } from './_shared/prompt.ts';
import { sha256Hex } from './_shared/sha256.ts';

export interface ExplainRequest { requestId: string; arm: TriageArm; bundles: PromptBundle[] }
export class ValidationError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); this.name = 'ValidationError'; }
}

function fail(code: string, status = 400): never { throw new ValidationError(code, status); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('expected-object');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail('unknown-or-missing-field');
}
function finitePrimitive(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
function validCellRef(value: string): boolean {
  const match = /^'((?:[^']|'')+)'!([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value);
  if (!match || match[1].replace(/''/g, "'").length > 31 || Number(match[3]) > 1048576) return false;
  let col = 0;
  for (const char of match[2]) col = col * 26 + char.charCodeAt(0) - 64;
  return col <= 16384;
}

function validateBundle(value: unknown): PromptBundle {
  const bundle = object(value);
  exactKeys(bundle, ['findingId', 'sha256', 'cells', 'labels', 'facts']);
  if (typeof bundle.findingId !== 'string' || !/^[a-f0-9]{12}$/.test(bundle.findingId) || typeof bundle.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(bundle.sha256)) fail('invalid-bundle-identity');
  const cells = object(bundle.cells);
  if (!Object.keys(cells).length) fail('empty-bundle');
  for (const [ref, raw] of Object.entries(cells)) {
    if (!validCellRef(ref)) fail('invalid-cell-reference');
    const cell = object(raw);
    exactKeys(cell, ['f', 't', 'v', 'fmt'], ['t', 'v']);
    if (typeof cell.t !== 'string' || !['n', 's', 'str', 'inlineStr', 'b', 'e', 'none'].includes(cell.t) || !finitePrimitive(cell.v) ||
      (cell.f !== undefined && typeof cell.f !== 'string') || (cell.fmt !== undefined && typeof cell.fmt !== 'string')) fail('invalid-bundle-cell');
  }
  const labels = object(bundle.labels);
  exactKeys(labels, ['row', 'col'], []);
  if (Object.values(labels).some((label) => typeof label !== 'string')) fail('invalid-label');
  const facts = object(bundle.facts);
  if (Object.values(facts).some((fact) => !(finitePrimitive(fact) || (Array.isArray(fact) && fact.every((part) => typeof part === 'string'))))) fail('invalid-fact');
  if (new TextEncoder().encode(canonicalJson(bundle)).length > MAX_BUNDLE_BYTES) fail('bundle-too-large', 413);
  const unsigned = { findingId: bundle.findingId, cells, labels, facts };
  if (sha256Hex(canonicalJson(unsigned)) !== bundle.sha256) fail('bundle-hash-mismatch');
  return bundle as unknown as PromptBundle;
}

/** Pure request validation, shared by tests and the authenticated handler. */
export function validateExplainRequest(value: unknown): ExplainRequest {
  const body = object(value);
  exactKeys(body, ['requestId', 'arm', 'bundles']);
  if (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) fail('invalid-request-id');
  if (body.arm !== 'generative' && body.arm !== 'jev') fail('invalid-arm');
  if (!Array.isArray(body.bundles) || body.bundles.length < 1 || body.bundles.length > MAX_BUNDLES) fail('invalid-bundle-count');
  const bundles = body.bundles.map(validateBundle);
  if (new Set(bundles.map((bundle) => bundle.findingId)).size !== bundles.length) fail('duplicate-finding-id');
  return { requestId: body.requestId, arm: body.arm, bundles };
}

export function parseExplainRequest(body: string): ExplainRequest {
  if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) fail('request-too-large', 413);
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { return fail('invalid-json'); }
  return validateExplainRequest(value);
}

/** Content-Length is only an early refusal. Actual streamed bytes are counted independently. */
export async function readBoundedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) fail('request-too-large', 413);
  if (!request.body) fail('missing-body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); fail('request-too-large', 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(combined); } catch { return fail('invalid-utf8'); }
}

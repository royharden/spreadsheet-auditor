import { describe, expect, it } from 'vitest';
import { canonicalJson } from './_shared/canonicalJson.ts';
import { MAX_REQUEST_BYTES } from './_shared/limits.ts';
import { sha256Hex } from './_shared/sha256.ts';
import { parseExplainRequest, readBoundedBody, validateExplainRequest } from './validate.ts';

function bundle(id = 'aaaaaaaaaaaa') {
  const unsigned = { findingId: id, cells: { "'S'!A1": { t: 'n', v: 5 } }, labels: {}, facts: {} };
  return { ...unsigned, sha256: sha256Hex(canonicalJson(unsigned)) };
}
function request(bundles: unknown[] = [bundle()]) { return { requestId: '00000000-0000-4000-8000-000000000001', arm: 'generative', bundles }; }

describe('pure bounded edge request validation', () => {
  it('accepts a canonical typed bundle with the measured hash', () => {
    expect(parseExplainRequest(JSON.stringify(request()))).toEqual(request());
  });
  it('refuses >200 bundles, duplicate finding ids and unknown fields at every schema level', () => {
    expect(() => validateExplainRequest(request(Array.from({ length: 201 }, () => bundle())))).toThrow('count');
    expect(() => validateExplainRequest(request([bundle(), bundle()]))).toThrow('duplicate');
    expect(() => validateExplainRequest({ ...request(), model: 'client-controlled' })).toThrow('field');
    expect(() => validateExplainRequest(request([{ ...bundle(), extra: true }]))).toThrow('field');
    const injected = bundle();
    Object.assign(injected.cells["'S'!A1"], { hidden: 'instruction' });
    expect(() => validateExplainRequest(request([injected]))).toThrow('field');
  });
  it('refuses oversized bundles and changed hashes rather than truncating evidence', () => {
    const large = bundle();
    Object.assign(large.labels, { row: 'x'.repeat(2100) });
    expect(() => validateExplainRequest(request([large]))).toThrow('bundle-too-large');
    const changed = bundle();
    changed.cells["'S'!A1"].v = 6;
    expect(() => validateExplainRequest(request([changed]))).toThrow('hash-mismatch');
  });
  it('counts UTF-8 body bytes, refuses malformed JSON/IDs and does not coerce nested data', () => {
    expect(() => parseExplainRequest(`${JSON.stringify(request())}${' '.repeat(MAX_REQUEST_BYTES)}`)).toThrow('request-too-large');
    expect(() => parseExplainRequest('🙂'.repeat(MAX_REQUEST_BYTES / 4 + 1))).toThrow('request-too-large');
    expect(() => parseExplainRequest('{')).toThrow('invalid-json');
    expect(() => validateExplainRequest({ ...request(), requestId: 'not-a-uuid' })).toThrow('request-id');
    const nested = bundle();
    Object.assign(nested.facts, { nested: { unsafe: true } });
    expect(() => validateExplainRequest(request([nested]))).toThrow('invalid-fact');
  });
  it('cancels an actually oversized stream even when Content-Length claims it is small', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES)); controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'content-length': '1' }, body: stream, duplex: 'half' };
    await expect(readBoundedBody(new Request('https://edge.invalid/explain-findings', init))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});

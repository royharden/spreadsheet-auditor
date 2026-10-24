import { describe, expect, it } from 'vitest';
import { canonicalJson } from './_shared/canonicalJson.ts';
import { sha256Hex } from './_shared/sha256.ts';
import { createHandler, ProviderError, type HandlerDependencies, type ServerConfig } from './handler.ts';

const unsigned = { findingId: 'aaaaaaaaaaaa', cells: { "'S'!A1": { t: 'n', v: 5 } }, labels: {}, facts: {} };
const bundle = { ...unsigned, sha256: sha256Hex(canonicalJson(unsigned)) };
const body = { requestId: '00000000-0000-4000-8000-000000000001', arm: 'generative', bundles: [bundle] };
const validResult = { findingId: bundle.findingId, bundleSha256: bundle.sha256, triage: 'unclear', explanation: 'A1 requires review.', cited_cells: ["'S'!A1"] };
const fixtureConfig: ServerConfig = { anthropicApiKey: 'test-only-provider-key', explainModel: 'fixture-model', typesafeApiKey: 'test-only-jev-key', jevModel: 'fixture-jev' };
function post(value: unknown = body, authorized = true): Request {
  return new Request('https://edge.invalid/explain-findings', { method: 'POST', headers: { ...(authorized ? { authorization: 'Bearer test-caller-jwt' } : {}), 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
function dependencies(events: string[], overrides: Partial<HandlerDependencies> = {}): HandlerDependencies {
  return {
    async authenticate(jwt) { events.push(`auth:${jwt}`); return { id: 'fixture-user' }; },
    config() { events.push('config'); return fixtureConfig; },
    async reserve(_jwt, _requestId, n) { events.push(`reserve:${n}`); return 998; },
    async invokeProvider() { events.push('provider'); return [validResult]; },
    ...overrides,
  };
}

describe('authenticated edge handler order and bounded attempts', () => {
  it('verifies caller identity then validates/configures/reserves before the first provider attempt', async () => {
    const events: string[] = [];
    const response = await createHandler(dependencies(events))(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [validResult] });
    expect(events).toEqual(['auth:test-caller-jwt', 'config', 'reserve:1', 'provider']);
  });
  it('refuses unauthenticated and invalid requests before config/reservation/provider', async () => {
    const events: string[] = [];
    const handler = createHandler(dependencies(events));
    expect((await handler(post(body, false))).status).toBe(401);
    expect(events).toEqual([]);
    expect((await handler(post({ unexpected: true }))).status).toBe(400);
    expect(events).toEqual(['auth:test-caller-jwt']);
    expect((await createHandler(dependencies([], { async authenticate() { return null; } }))(post())).status).toBe(401);
  });
  it('returns 503 for missing server configuration, and never reserves or calls a provider', async () => {
    const events: string[] = [];
    const handler = createHandler(dependencies(events, { config() { events.push('config'); return {}; } }));
    const response = await handler(post());
    expect(response.status).toBe(503);
    expect(events).toEqual(['auth:test-caller-jwt', 'config']);
  });
  it('returns 429 for quota/replay refusal before any provider call', async () => {
    const events: string[] = [];
    const seen = new Set<string>();
    const handler = createHandler(dependencies(events, { async reserve(_jwt, requestId) {
      events.push('reserve');
      if (seen.has(requestId)) throw new Error('duplicate reservation fixture');
      seen.add(requestId); return 998;
    } }));
    expect((await handler(post())).status).toBe(200);
    expect((await handler(post())).status).toBe(429);
    expect(events.filter((event) => event === 'provider')).toHaveLength(1);
  });
  it('reserves exactly once while retrying a transient single-attempt transport at most once', async () => {
    const events: string[] = [];
    let attempts = 0;
    const handler = createHandler(dependencies(events, { async invokeProvider() {
      events.push('provider'); attempts++;
      if (attempts === 1) throw new ProviderError(true);
      return [validResult];
    } }));
    expect((await handler(post())).status).toBe(200);
    expect(events.filter((event) => event.startsWith('reserve'))).toHaveLength(1);
    expect(attempts).toBe(2);
    let failedAttempts = 0;
    const failed = createHandler(dependencies([], { async invokeProvider() { failedAttempts++; throw new ProviderError(true); } }));
    expect((await failed(post())).status).toBe(502);
    expect(failedAttempts).toBe(2);
  });
  it.each([
    { raw: [{ ...validResult, tier: 'confirmed' }] }, { raw: [{ ...validResult, fix: '=1' }] },
    { raw: [{ ...validResult, findingId: 'bbbbbbbbbbbb' }] }, { raw: [{ ...validResult, bundleSha256: '0'.repeat(64) }] },
    { raw: [validResult, validResult] }, { raw: [] },
  ])('strictly rejects added/mismatched/duplicated/omitted output without retrying schema failures', async ({ raw }) => {
    let attempts = 0;
    const handler = createHandler(dependencies([], { async invokeProvider() { attempts++; return raw; } }));
    expect((await handler(post())).status).toBe(502);
    expect(attempts).toBe(1);
  });
  it('GET readiness authenticates and skips body validation, quota and provider; preflight skips auth', async () => {
    const events: string[] = [];
    const handler = createHandler(dependencies(events));
    const readiness = await handler(new Request('https://edge.invalid/explain-findings', { headers: { authorization: 'Bearer test-caller-jwt', 'content-length': '99999999' } }));
    expect(readiness.status).toBe(200);
    const data = await readiness.json() as { configured: boolean; reasons: string[] };
    expect(data).toMatchObject({ configured: true, reasons: [] });
    expect(JSON.stringify(data)).not.toContain('test-only-provider-key');
    expect(events).toEqual(['auth:test-caller-jwt', 'config']);
    expect((await handler(new Request('https://edge.invalid/explain-findings', { method: 'OPTIONS' }))).status).toBe(204);
    expect(events).toEqual(['auth:test-caller-jwt', 'config']);
  });
  it('keeps paid Jev fail-closed before quota/provider while ordinary generative readiness stays available', async () => {
    const events: string[] = [];
    const handler = createHandler(dependencies(events));
    const disabled = await handler(post({ ...body, arm: 'jev' }));
    expect(disabled.status).toBe(503);
    expect(await disabled.text()).toContain('bound has not been verified');
    expect(events).toEqual(['auth:test-caller-jwt', 'config']);
    const readiness = await handler(new Request('https://edge.invalid/explain-findings?arm=jev', { headers: { authorization: 'Bearer test-caller-jwt' } }));
    expect(await readiness.json()).toMatchObject({ configured: false });
    expect(events.filter((event) => event.startsWith('reserve') || event === 'provider')).toEqual([]);
  });
});

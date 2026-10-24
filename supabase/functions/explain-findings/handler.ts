import { MAX_OUTPUT_TOKENS, MAX_RETRIES, PROVIDER_TIMEOUT_MS } from './_shared/limits.ts';
import { buildPrompt, type PromptBundle, type TriageArm } from './_shared/prompt.ts';
import { parseTriageResponse, parseTypeSafeResponse, type TriageResult } from './_shared/triageSchema.ts';
import { parseExplainRequest, readBoundedBody, ValidationError, type ExplainRequest } from './validate.ts';

export interface ServerConfig {
  anthropicApiKey?: string;
  typesafeApiKey?: string;
  explainModel?: string;
  jevModel?: string;
  maxOutputTokens?: string;
}
export interface ProviderInput {
  arm: TriageArm;
  model: string;
  apiKey: string;
  maxOutputTokens: number;
  prompt: { system: string; user: string };
  bundles: PromptBundle[];
  signal: AbortSignal;
}
export interface HandlerDependencies {
  /** The index implementation calls supabase.auth.getUser(jwt), never trusts decoded claims. */
  authenticate(jwt: string): Promise<{ id: string } | null>;
  config(): ServerConfig;
  /** Calls reserve_explain_quota(requestId,n) using the same caller JWT, exactly once. */
  reserve(jwt: string, requestId: string, n: number): Promise<number>;
  /** Exactly one HTTP attempt. Only the handler owns retries. */
  invokeProvider(input: ProviderInput): Promise<unknown>;
}
export class ProviderError extends Error {
  constructor(readonly retryable: boolean) { super('provider-request-failed'); this.name = 'ProviderError'; }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function configured(config: ServerConfig, arm: TriageArm): { configured: boolean; reasons: string[]; model: string; apiKey: string; maxOutputTokens: number } {
  // This singleton server-side model allowlist never accepts a client-supplied model id.
  const model = (arm === 'generative' ? config.explainModel : config.jevModel)?.trim() ?? '';
  const apiKey = (arm === 'generative' ? config.anthropicApiKey : config.typesafeApiKey)?.trim() ?? '';
  const reasons: string[] = [];
  if (!apiKey) reasons.push(`${arm} provider secret is missing`);
  if (!model || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model)) reasons.push(`${arm} server model is missing or invalid`);
  if (arm === 'jev') reasons.push('Jev live requests are disabled: a documented worst-case output-token/spend bound has not been verified');
  const tokenText = config.maxOutputTokens ?? String(MAX_OUTPUT_TOKENS);
  const tokens = /^\d+$/.test(tokenText) ? Number(tokenText) : NaN;
  if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > MAX_OUTPUT_TOKENS) reasons.push('server output-token cap is invalid');
  return { configured: reasons.length === 0, reasons, model, apiKey, maxOutputTokens: tokens };
}

async function invokeWithTimeout(dependencies: HandlerDependencies, input: Omit<ProviderInput, 'signal'>): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dependencies.invokeProvider({ ...input, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ProviderError(true)); }, PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function bindResults(results: TriageResult[], bundles: PromptBundle[]): void {
  const submitted = new Map(bundles.map((bundle) => [bundle.findingId, bundle.sha256]));
  const seen = new Set<string>();
  if (results.length !== submitted.size) throw new ProviderError(false);
  for (const result of results) {
    if (seen.has(result.findingId) || submitted.get(result.findingId) !== result.bundleSha256) throw new ProviderError(false);
    seen.add(result.findingId);
  }
}

/** POST order: verified identity -> bounded validation -> config -> reservation -> attempts -> strict parse. */
export function createHandler(dependencies: HandlerDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'POST') return response(405, { error: 'method-not-allowed' });
    const authorization = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!authorization) return response(401, { error: 'authentication-required' });
    const jwt = authorization[1];
    let user: { id: string } | null;
    try { user = await dependencies.authenticate(jwt); } catch { return response(401, { error: 'authentication-failed' }); }
    if (!user?.id) return response(401, { error: 'authentication-failed' });
    if (request.method === 'GET') {
      const config = dependencies.config();
      const generative = configured(config, 'generative');
      const jev = configured(config, 'jev');
      const arm = new URL(request.url).searchParams.get('arm');
      if (arm !== null && arm !== 'generative' && arm !== 'jev') return response(400, { error: 'invalid-readiness-arm' });
      const readiness = arm === 'jev' ? jev : generative;
      return response(200, { configured: readiness.configured, reasons: readiness.reasons, arms: { generative: { configured: generative.configured, reasons: generative.reasons }, jev: { configured: jev.configured, reasons: jev.reasons } } });
    }
    let input: ExplainRequest;
    try { input = parseExplainRequest(await readBoundedBody(request)); } catch (error) {
      return error instanceof ValidationError ? response(error.status, { error: error.code }) : response(400, { error: 'invalid-request' });
    }
    const config = configured(dependencies.config(), input.arm);
    if (!config.configured) return response(503, { error: 'not-configured', reasons: config.reasons });
    try {
      const remaining = await dependencies.reserve(jwt, input.requestId, input.bundles.length);
      if (!Number.isSafeInteger(remaining) || remaining < 0) return response(429, { error: 'quota-reservation-failed' });
    } catch { return response(429, { error: 'quota-reservation-failed' }); }
    const prompt = buildPrompt(input.bundles, input.arm);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await invokeWithTimeout(dependencies, { arm: input.arm, model: config.model, apiKey: config.apiKey, maxOutputTokens: config.maxOutputTokens, prompt, bundles: input.bundles });
        const results = parseTriageResponse(input.arm === 'jev' ? parseTypeSafeResponse(raw, input.bundles) : raw);
        bindResults(results, input.bundles);
        return response(200, { results });
      } catch (error) {
        if (attempt < MAX_RETRIES && error instanceof ProviderError && error.retryable) continue;
        return response(502, { error: 'provider-response-unavailable' });
      }
    }
    return response(502, { error: 'provider-response-unavailable' });
  };
}

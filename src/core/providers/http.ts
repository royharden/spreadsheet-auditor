import { MAX_OUTPUT_TOKENS, MAX_RETRIES, PROVIDER_TIMEOUT_MS } from '../explain/limits.ts';
import type { ProviderOptions } from './types.ts';
export function serverOnly(): void { if ('document' in globalThis) throw new Error('Provider secrets belong in Node/Deno only.'); }
function tokens(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export async function providerJson<T>(options: ProviderOptions, url: string, body: unknown, headers: Record<string, string>, parse: (value: unknown) => T): Promise<T> {
  serverOnly();
  const retries = options.retries ?? MAX_RETRIES;
  if ((retries !== 0 && retries !== 1) || !options.model || !options.apiKey || !Number.isSafeInteger(options.maxTokens ?? MAX_OUTPUT_TOKENS) || (options.maxTokens ?? MAX_OUTPUT_TOKENS) < 1 || (options.maxTokens ?? MAX_OUTPUT_TOKENS) > MAX_OUTPUT_TOKENS) throw new Error('Invalid provider configuration.');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const started = Date.now();
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    try {
      const response = await options.transport(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      const raw: unknown = await response.json();
      if (raw && typeof raw === 'object') {
        const source = raw as Record<string, unknown>;
        if (typeof source.model === 'string' && source.model !== options.model) throw new Error('Provider returned an unpinned model.');
        const usage = source.usage as Record<string, unknown> | undefined;
        inputTokens = tokens(usage?.input_tokens); outputTokens = tokens(usage?.output_tokens);
      }
      const result = parse(raw);
      options.onAttempt?.({ inputTokens, outputTokens, latencyMs: Date.now() - started, status: 'live' });
      return result;
    } catch (error) {
      options.onAttempt?.({ inputTokens, outputTokens, latencyMs: Date.now() - started, status: 'error' });
      if (attempt === retries) throw new Error('Provider transport, status or response schema failed.', { cause: error });
    } finally { clearTimeout(timer); }
  }
  throw new Error('Provider attempt limit reached.');
}

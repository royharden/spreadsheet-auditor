// HTTP shape is source-only; model/account support is checked at activation, never assumed.
import { MAX_OUTPUT_TOKENS } from '../explain/limits.ts';
import { buildPrompt } from '../explain/prompt.ts';
import { parseTriageResponse } from '../explain/triageSchema.ts';
import { providerJson } from './http.ts';
import type { ProviderOptions, TriageProvider } from './types.ts';
export function createAnthropicProvider(options: ProviderOptions): TriageProvider {
  return { origin: 'live', async triage(request) {
    if (request.arm !== 'generative' || request.model !== options.model) throw new Error('Provider arm/model mismatch.');
    const prompt = buildPrompt(request.bundles, request.arm);
    return providerJson(options, 'https://api.anthropic.com/v1/messages', { model: options.model, max_tokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
      system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }, { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' }, (value) => {
      const raw = value as { content?: { type?: string; text?: string }[] } | null;
      if (!Array.isArray(raw?.content) || raw.content.some((block) => block.type !== 'text' || typeof block.text !== 'string')) throw new Error('Provider returned unexpected content.');
      return parseTriageResponse(JSON.parse(raw.content.map((block) => block.text).join('')) as unknown);
    });
  } };
}

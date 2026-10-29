import { MAX_REQUEST_BYTES } from './_shared/limits.ts';
import { buildTypeSafeRequest } from './_shared/prompt.ts';
import { ProviderError, type ProviderInput } from './handler.ts';

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ProviderError(false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ProviderError(false); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ProviderError(false); }
}

/** Deno/Web-only single attempt: no Node imports, retry loop, ambient keys or content logging. */
export function createSingleAttemptTransport(fetcher: typeof fetch = fetch): (input: ProviderInput) => Promise<unknown> {
  return async (input) => {
    const generative = input.arm === 'generative';
    let response: Response;
    try {
      response = await fetcher(generative ? 'https://api.anthropic.com/v1/messages' : 'https://api.typesafe.ai/v1/systemone', {
        method: 'POST', redirect: 'error', signal: input.signal,
        headers: generative ? { 'Content-Type': 'application/json', 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify(generative ? { model: input.model, max_tokens: input.maxOutputTokens, system: input.prompt.system, messages: [{ role: 'user', content: input.prompt.user }] } : buildTypeSafeRequest(input.model, input.bundles)),
      });
    } catch { throw new ProviderError(true); }
    if (!response.ok) throw new ProviderError(response.status === 429 || response.status >= 500);
    const raw = await boundedJson(response);
    if (!generative) return raw;
    if (raw === null || typeof raw !== 'object' || !('content' in raw) || !Array.isArray(raw.content)) throw new ProviderError(false);
    const text = raw.content.filter((block: unknown): block is { type: string; text: string } => block !== null && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string').map((block) => block.text).join('\n');
    try { return JSON.parse(text) as unknown; } catch { throw new ProviderError(false); }
  };
}

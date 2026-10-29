import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, type PromptBundle } from './_shared/prompt.ts';
import type { ProviderInput } from './handler.ts';
import { createSingleAttemptTransport } from './transport.ts';

const bundle: PromptBundle = { findingId: 'aaaaaaaaaaaa', sha256: 'a'.repeat(64), cells: { "'S'!A1": { t: 'n', v: 5 } }, labels: {}, facts: {} };
function input(arm: ProviderInput['arm']): ProviderInput {
  return { arm, model: 'fixture-model', apiKey: 'test-only-key', maxOutputTokens: 50, prompt: buildPrompt([bundle], arm), bundles: [bundle], signal: new AbortController().signal };
}

describe('single-attempt server transport', () => {
  it('uses bounded generative messages and returns only JSON content for strict handler parsing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: '[]' }] })));
    const result = await createSingleAttemptTransport(fetcher)(input('generative'));
    expect(result).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'fixture-model', max_tokens: 50 });
    expect(init?.redirect).toBe('error');
  });
  it('uses documented TypeSafe state/questions/criteria shape and never an options array', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {} })));
    await createSingleAttemptTransport(fetcher)(input('jev'));
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(String(init?.body)) as { state: unknown; questions: Record<string, { type: string; criteria: Record<string, string>; options?: unknown }> };
    expect(body.state).toEqual({ bundles: [bundle] });
    expect(body.questions[bundle.findingId].type).toBe('choice');
    expect(Object.keys(body.questions[bundle.findingId].criteria).sort()).toEqual(['by_design', 'mistake', 'unclear']);
    expect(body.questions[bundle.findingId].options).toBeUndefined();
  });
  it('marks transient HTTP failures for handler retry but performs only one HTTP call itself', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider body', { status: 503 }));
    await expect(createSingleAttemptTransport(fetcher)(input('generative'))).rejects.toMatchObject({ retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

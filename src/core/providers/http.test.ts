import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic.ts';
import { createEdgeProvider } from './edgeClient.ts';
describe('provider transport boundaries', () => {
  it('bounds a Node request to the first attempt plus one retry', async () => {
    const transport = vi.fn(async () => new Response('', { status: 503 }));
    const attempts = vi.fn();
    const provider = createAnthropicProvider({ model: 'fixture', apiKey: 'test-only', transport, onAttempt: attempts });
    await expect(provider.triage({ requestId: 'fixture', arm: 'generative', model: 'fixture', bundles: [] })).rejects.toThrow('Provider');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveBeenCalledTimes(2);
  });
  it('the browser edge client sends request id, arm and bundles only, with no nested retry', async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      expect(Object.keys(JSON.parse(String(init.body)) as object).sort()).toEqual(['arm', 'bundles', 'requestId']);
      return new Response(JSON.stringify({ results: [] }));
    });
    const provider = createEdgeProvider({ url: 'https://example.test/explain-findings', accessToken: async () => 'test-token', transport });
    expect(await provider.triage({ requestId: 'fixture', arm: 'generative', model: 'server-owned', bundles: [] })).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { buildBudgetQ3 } from '../../../generator/samples.ts';
import { runAudit } from '../audit.ts';
import { buildTypeSafeRequest } from '../explain/prompt.ts';
import { parseTypeSafeResponse } from '../explain/triageSchema.ts';
import { selectTriage } from '../triage/select.ts';
import { createTypeSafeProvider } from './typesafe.ts';

describe('TypeSafe choice adapter source contract', () => {
  it('uses documented state/questions/criteria and preserves choices when criteria order changes', async () => {
    const bundles = selectTriage(runAudit(buildBudgetQ3(1)), 'jev').bundles;
    for (const order of [['mistake', 'by_design', 'unclear'], ['unclear', 'by_design', 'mistake']] as const) {
      const request = buildTypeSafeRequest('configured-test-model', bundles, order);
      expect(Object.keys(request.questions[bundles[0].findingId].criteria)).toEqual(order);
      const transport = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown>; options?: unknown; max_tokens?: unknown };
        expect(body.options).toBeUndefined(); expect(body.max_tokens).toBeUndefined();
        return new Response(JSON.stringify({ model: 'configured-test-model', answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id,
          { type: 'choice', choice: 'by_design', confidence: 1, probabilities: { mistake: 0, by_design: 1, unclear: 0 } }])), usage: { input_tokens: 10, output_tokens: 20 } }));
      });
      const result = await createTypeSafeProvider({ apiKey: 'test-only', model: 'configured-test-model', transport, criteriaOrder: order, retries: 0 }).triage({ requestId: 'fixture', arm: 'jev', model: 'configured-test-model', bundles });
      expect(result.every((row) => row.triage === 'by_design')).toBe(true);
      expect(transport.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    }
  });
  it('keeps uncertain, missing or malformed judgments unclear', () => {
    const bundles = selectTriage(runAudit(buildBudgetQ3(1)), 'jev').bundles;
    const id = bundles[0].findingId;
    const answer = { type: 'choice', choice: 'by_design', confidence: 0.8, probabilities: { mistake: 0.1, by_design: 0.8, unclear: 0.1 } };
    expect(parseTypeSafeResponse({ answers: { [id]: answer } }, bundles)[0].triage).toBe('unclear');
    expect(parseTypeSafeResponse({ answers: {} }, bundles)[0].triage).toBe('unclear');
    expect(parseTypeSafeResponse({ answers: { [id]: { ...answer, confidence: 1, probabilities: {} } } }, bundles)[0].triage).toBe('unclear');
  });
});

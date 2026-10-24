import { describe, expect, it } from 'vitest';
import { BudgetError, CallLedger, costLabel } from './ledger.ts';
import { choiceOutputBound, PRICES, pricesReady, type Price } from './prices.ts';
const prices: Price[] = [{ model: 'fixture', verifiedAt: '2026-10-24', inputUsdPerMillion: 1, outputUsdPerMillion: 2 }];
describe('pre-call spending guard', () => {
  it('refuses unknown pricing and an over-budget retry-inclusive worst case before a call', () => {
    expect(PRICES).toEqual([]); expect(pricesReady(['fixture'])).toBe(false);
    expect(() => new CallLedger(1).reserve('fixture', 1000)).toThrow(BudgetError);
    const ledger = new CallLedger(0.001, [], prices);
    expect(() => ledger.reserve('fixture', 1000, 1000)).toThrow('could exceed');
    const allowed = new CallLedger(0.006, [], prices);
    expect(allowed.reserve('fixture', 1000, 1000)).toBe(0.006);
    expect(() => allowed.reserve('fixture', 1, 1)).toThrow();
  });
  it('never prints unknown cost as zero and requires documentary Jev output-bound evidence', () => {
    expect(costLabel(null)).toBe('unknown');
    expect(choiceOutputBound(prices[0])).toBeNull();
    expect(choiceOutputBound({ ...prices[0], choiceOutputBound: { tokensPerRequest: 1000, verifiedAt: '2026-10-24', sourceUrl: 'https://docs.typesafe.ai/api/system-one' } })).toBe(1000);
  });
});

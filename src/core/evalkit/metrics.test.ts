import { describe, expect, it } from 'vitest';
import { RULE_IDS } from '../rules/types.ts';
import { matchDetections, type RuleCounts } from './match.ts';
import { metricsFor, summarizeMetrics } from './metrics.ts';
import { wilson95 } from './wilson.ts';

describe('Wilson 95% and metric denominators', () => {
  it('matches independently tabulated hand examples, including boundary proportions', () => {
    // z=1.95996398454; n=10. Hand-rounded score endpoints, not values computed by this function.
    expect(wilson95(5, 10)?.low).toBeCloseTo(0.2365931, 6);
    expect(wilson95(5, 10)?.high).toBeCloseTo(0.7634069, 6);
    expect(wilson95(0, 10)?.low).toBeCloseTo(0, 10);
    expect(wilson95(0, 10)?.high).toBeCloseTo(0.2775328, 6);
    expect(wilson95(10, 10)?.low).toBeCloseTo(0.7224672, 6);
    expect(wilson95(10, 10)?.high).toBeCloseTo(1, 10);
    expect(wilson95(0, 0)).toBeNull();
    expect(() => wilson95(2, 1)).toThrow();
    expect(() => wilson95(0.5, 1)).toThrow();
  });

  it('uses pooled micro counts and averages only defined per-rule macro points', () => {
    const result = matchDetections([], []);
    result.byRule.ERROR_VALUE = { tp: 1, fp: 1, fn: 0, neutral: 2, rawDetections: 4 };
    result.byRule.BROKEN_REF = { tp: 3, fp: 0, fn: 1, neutral: 0, rawDetections: 3 };
    const summary = summarizeMetrics(result);
    expect(summary.micro).toMatchObject({ tp: 4, fp: 1, fn: 1, neutral: 2, rawDetections: 7, precision: { value: 0.8 }, recall: { value: 0.8 }, f1: 0.8 });
    expect(summary.macro).toMatchObject({ precision: 0.75, recall: 0.875, definedRules: { precision: 2, recall: 2, f1: 2 }, interval: null, intervalMethod: 'not-binomial' });
    expect(summary.macro.f1).toBeCloseTo((2 / 3 + 6 / 7) / 2);
    for (const rule of RULE_IDS.slice(2)) expect(summary.perRule[rule].precision.value).toBeNull();
  });

  it('does not turn unknown ratios into zero or include neutral cells in precision', () => {
    const empty: RuleCounts = { tp: 0, fp: 0, fn: 0, neutral: 9, rawDetections: 9 };
    expect(metricsFor(empty)).toMatchObject({ precision: { value: null, interval: null }, recall: { value: null, interval: null }, f1: null });
    expect(metricsFor({ ...empty, fn: 1 })).toMatchObject({ precision: { value: null }, recall: { value: 0 }, f1: 0 });
    expect(summarizeMetrics(matchDetections([], [])).macro).toMatchObject({ precision: null, recall: null, f1: null });
  });
});

import { RULE_IDS, type RuleId } from '../rules/types.ts';
import type { MatchResult, RuleCounts } from './match.ts';
import { wilson95, type Interval } from './wilson.ts';

export interface Proportion { value: number | null; interval: Interval | null }
export interface Metrics extends RuleCounts { precision: Proportion; recall: Proportion; f1: number | null }
export interface MacroMetrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  definedRules: { precision: number; recall: number; f1: number };
  /** An average of proportions is not a binomial observation. Component Wilson intervals are per-rule. */
  interval: null;
  intervalMethod: 'not-binomial';
}
export interface MetricSummary { perRule: Record<RuleId, Metrics>; micro: Metrics; macro: MacroMetrics }

export function metricsFor(counts: RuleCounts): Metrics {
  const precisionTrials = counts.tp + counts.fp;
  const recallTrials = counts.tp + counts.fn;
  const f1Denominator = 2 * counts.tp + counts.fp + counts.fn;
  return {
    ...counts,
    precision: { value: precisionTrials === 0 ? null : counts.tp / precisionTrials, interval: wilson95(counts.tp, precisionTrials) },
    recall: { value: recallTrials === 0 ? null : counts.tp / recallTrials, interval: wilson95(counts.tp, recallTrials) },
    f1: f1Denominator === 0 ? null : 2 * counts.tp / f1Denominator,
  };
}

function meanDefined(values: readonly (number | null)[]): { value: number | null; count: number } {
  const defined = values.filter((value): value is number => value !== null);
  return { value: defined.length ? defined.reduce((sum, value) => sum + value, 0) / defined.length : null, count: defined.length };
}

export function summarizeMetrics(result: MatchResult): MetricSummary {
  const perRule = Object.fromEntries(RULE_IDS.map((rule) => [rule, metricsFor(result.byRule[rule])])) as Record<RuleId, Metrics>;
  const pooled: RuleCounts = { tp: 0, fp: 0, fn: 0, neutral: 0, rawDetections: 0 };
  for (const rule of RULE_IDS) for (const key of ['tp', 'fp', 'fn', 'neutral', 'rawDetections'] as const) pooled[key] += result.byRule[rule][key];
  const precision = meanDefined(RULE_IDS.map((rule) => perRule[rule].precision.value));
  const recall = meanDefined(RULE_IDS.map((rule) => perRule[rule].recall.value));
  const f1 = meanDefined(RULE_IDS.map((rule) => perRule[rule].f1));
  return {
    perRule, micro: metricsFor(pooled),
    macro: { precision: precision.value, recall: recall.value, f1: f1.value, definedRules: { precision: precision.count, recall: recall.count, f1: f1.count }, interval: null, intervalMethod: 'not-binomial' },
  };
}

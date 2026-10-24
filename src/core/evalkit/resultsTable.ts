import type { AuditedFinding } from '../audit.ts';
import { RULE_IDS } from '../rules/types.ts';
import { detectionKey, locationKey, normalizeWorkbook, type Detection, type ManifestRow } from './manifest.ts';
import { matchDetections, type MatchResult } from './match.ts';
import { summarizeMetrics, type MetricSummary, type Metrics, type Proportion } from './metrics.ts';

export type SystemId = '1' | '2' | '3';
export const SYSTEM_NAMES: Record<SystemId, string> = { '1': 'rules + templates', '2': 'rules + generative', '3': 'rules + Jev (Review only)' };
export const TEMPLATE_PROMPT_VERSION = 'code-templates-v1';
export interface EvaluationLedgerRow { latencyMs: number; costUsd: number | null; status: string }
export interface Observation {
  workbook: string;
  findings: AuditedFinding[];
  /** Code must retain the raw findings; these ids affect only the surfaced view. */
  setAsideIds: string[];
  ledger: EvaluationLedgerRow[];
}
export interface PairMetadata { workbook: string; pairId: string; variant: 'clean' | 'injected' }
export interface Failure extends Detection { kind: 'FP' | 'FN' | 'set-aside-defect'; stage: 'raw' | 'surfaced' | 'set-aside' }
export interface InjectionDelta {
  pairId: string;
  clean: { defects: number; benign: number } | null;
  injected: { defects: number; benign: number } | null;
  defectDelta: number | null;
  benignDelta: number | null;
}
export type Cost = { kind: 'unknown' } | { kind: 'replay' } | { kind: 'usd'; value: number };
export interface CompleteResult {
  system: SystemId;
  status: 'complete';
  provenance: 'template' | 'live' | 'recorded-live' | 'replay';
  raw: MetricSummary;
  surfaced: MetricSummary;
  submittedRawDetections: number;
  dedupedRawDetections: number;
  duplicateDetections: number;
  rawCitationFailures: number;
  rawCitationFailedFindings: number;
  postFallbackUnresolvedCitations: number;
  citationInvariantPassed: boolean;
  setAsideDefects: Failure[];
  setAsideBenign: number;
  setAsideCommonReviewDefects: number;
  injectionDeltas: InjectionDelta[];
  plantedExplanationCoverage: { eligible: number; explained: number; proportion: number | null };
  latencyMs: { p50: number | null; max: number | null; samples: number };
  cost: Cost;
  failures: Failure[];
}
export type NotRunResult = { system: SystemId; status: 'not-run'; reason: string } & {
  [Field in Exclude<keyof CompleteResult, 'system' | 'status'>]: null;
};
export type SystemResult = CompleteResult | NotRunResult;
export interface EvaluationReport {
  schemaVersion: 1;
  generatedAt: string;
  split: string;
  pins: Record<string, unknown>;
  systems: SystemResult[];
  jevOutcome: 'won' | 'lost' | 'not-evaluated';
  jevSentence: string;
}

/** Preserve the report schema while making every unavailable measurement explicit. */
export function notRunResult(system: SystemId, reason: string): NotRunResult {
  return {
    system, status: 'not-run', reason, provenance: null, raw: null, surfaced: null,
    submittedRawDetections: null, dedupedRawDetections: null, duplicateDetections: null,
    rawCitationFailures: null, rawCitationFailedFindings: null, postFallbackUnresolvedCitations: null,
    citationInvariantPassed: null, setAsideDefects: null, setAsideBenign: null,
    setAsideCommonReviewDefects: null, injectionDeltas: null, plantedExplanationCoverage: null,
    latencyMs: null, cost: null, failures: null,
  };
}

function detections(observations: readonly Observation[], surfaced: boolean): Detection[] {
  return observations.flatMap((observation) => observation.findings.filter((finding) => !surfaced || !observation.setAsideIds.includes(finding.id))
    .map((finding) => ({ workbook: observation.workbook, sheet: finding.sheet, cell: finding.cell, ruleId: finding.ruleId })));
}

function failures(result: MatchResult, stage: 'raw' | 'surfaced'): Failure[] {
  return [
    ...result.matches.filter((match) => match.outcome === 'FP').map((match): Failure => ({ ...match.detection, kind: 'FP', stage })),
    ...result.falseNegatives.flatMap((row): Failure[] => row.primaryRule === null ? [] : [{ workbook: row.workbook, sheet: row.sheet, cell: row.cell, ruleId: row.primaryRule, kind: 'FN', stage }]),
  ];
}

export function summarizeLedger(rows: readonly EvaluationLedgerRow[]): { latencyMs: CompleteResult['latencyMs']; cost: Cost } {
  for (const row of rows) {
    if (!Number.isFinite(row.latencyMs) || row.latencyMs < 0 || (row.costUsd !== null && (!Number.isFinite(row.costUsd) || row.costUsd < 0))) throw new Error('Invalid ledger measurement.');
  }
  const times = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const p50 = times.length === 0 ? null : times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
  let cost: Cost = { kind: 'unknown' };
  if (rows.length && rows.every((row) => row.status === 'replay')) cost = { kind: 'replay' };
  else if (rows.length && rows.every((row) => row.costUsd !== null)) cost = { kind: 'usd', value: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) };
  return { latencyMs: { p50, max: times.length ? times[times.length - 1] : null, samples: times.length }, cost };
}

/** Pure M5 seam: submit checked explanations, raw detections, set-aside ids and actual ledger rows. */
export function buildSystemResult(
  system: SystemId,
  provenance: CompleteResult['provenance'] | 'synthetic-test',
  manifest: readonly ManifestRow[],
  observations: readonly Observation[],
  pairs: readonly PairMetadata[],
): SystemResult {
  if (system !== '1' && provenance === 'synthetic-test') return notRunResult(system, 'Synthetic cache is not evaluation evidence; not run.');
  if (provenance === 'synthetic-test') throw new Error('System 1 must use code templates.');
  const rowByLocation = new Map(manifest.map((row) => [locationKey(row), row]));
  const setAsideDefects: Failure[] = [];
  let setAsideBenign = 0;
  const asideByWorkbook = new Map<string, { defects: number; benign: number }>();
  const explained = new Set<string>();
  let rawCitationFailures = 0;
  let rawCitationFailedFindings = 0;
  let postFallbackUnresolvedCitations = 0;
  const seenExplanations = new Set<string>();
  const seenWorkbooks = new Set<string>();
  for (const observation of observations) {
    const workbookKey = normalizeWorkbook(observation.workbook);
    if (seenWorkbooks.has(workbookKey)) throw new Error('Duplicate workbook observation.');
    seenWorkbooks.add(workbookKey);
    const ids = new Set(observation.findings.map((finding) => finding.id));
    if (new Set(observation.setAsideIds).size !== observation.setAsideIds.length || observation.setAsideIds.some((id) => !ids.has(id))) throw new Error('Invalid set-aside finding ids.');
    const aside = { defects: 0, benign: 0 };
    for (const finding of observation.findings) {
      const detection: Detection = { workbook: observation.workbook, sheet: finding.sheet, cell: finding.cell, ruleId: finding.ruleId };
      const key = detectionKey(detection);
      if (seenExplanations.has(key)) continue;
      seenExplanations.add(key);
      const row = rowByLocation.get(locationKey(detection));
      const isPrimary = row?.truth === 'defect' && row.primaryRule === finding.ruleId;
      const failuresBeforeFallback = finding.explanation.modelFailures?.length ?? 0;
      rawCitationFailures += failuresBeforeFallback;
      if (failuresBeforeFallback > 0) rawCitationFailedFindings++;
      if (!finding.explanation.checker.ok || finding.explanation.unavailable || finding.explanation.explanation === null) postFallbackUnresolvedCitations++;
      else if (isPrimary && row.denominatorEligible) explained.add(locationKey(row));
      if (!observation.setAsideIds.includes(finding.id)) continue;
      if (finding.tier === 'confirmed') throw new Error('Confirmed findings cannot be set aside.');
      if (isPrimary) {
        aside.defects++;
        setAsideDefects.push({ ...detection, kind: 'set-aside-defect', stage: 'set-aside' });
      } else { aside.benign++; setAsideBenign++; }
    }
    asideByWorkbook.set(normalizeWorkbook(observation.workbook), aside);
  }
  const raw = matchDetections(manifest, detections(observations, false));
  const surfaced = matchDetections(manifest, detections(observations, true));
  const eligible = manifest.filter((row) => row.truth === 'defect' && row.denominatorEligible).length;
  const grouped = new Map<string, { clean?: PairMetadata; injected?: PairMetadata }>();
  for (const pair of pairs) {
    const group = grouped.get(pair.pairId) ?? {};
    if (group[pair.variant]) throw new Error('Duplicate pair variant.');
    group[pair.variant] = pair;
    grouped.set(pair.pairId, group);
  }
  const injectionDeltas = [...grouped].map(([pairId, pair]): InjectionDelta => {
    const clean = pair.clean ? asideByWorkbook.get(normalizeWorkbook(pair.clean.workbook)) ?? null : null;
    const injected = pair.injected ? asideByWorkbook.get(normalizeWorkbook(pair.injected.workbook)) ?? null : null;
    return { pairId, clean, injected, defectDelta: clean && injected ? injected.defects - clean.defects : null, benignDelta: clean && injected ? injected.benign - clean.benign : null };
  });
  return {
    system, status: 'complete', provenance, raw: summarizeMetrics(raw), surfaced: summarizeMetrics(surfaced),
    submittedRawDetections: raw.submitted, dedupedRawDetections: raw.deduped, duplicateDetections: raw.duplicates,
    rawCitationFailures, rawCitationFailedFindings, postFallbackUnresolvedCitations, citationInvariantPassed: postFallbackUnresolvedCitations === 0,
    setAsideDefects, setAsideBenign, setAsideCommonReviewDefects: setAsideDefects.filter((finding) => finding.ruleId === 'MIXED_UNITS').length,
    injectionDeltas, plantedExplanationCoverage: { eligible, explained: explained.size, proportion: eligible ? explained.size / eligible : null },
    ...summarizeLedger(observations.flatMap((observation) => observation.ledger)),
    failures: [...failures(raw, 'raw'), ...failures(surfaced, 'surfaced'), ...setAsideDefects],
  };
}

export function jevDisposition(systems: readonly SystemResult[], maximumSetAsideDefects: number): EvaluationReport['jevOutcome'] {
  const one = systems.find((result): result is CompleteResult => result.system === '1' && result.status === 'complete');
  const two = systems.find((result): result is CompleteResult => result.system === '2' && result.status === 'complete');
  const three = systems.find((result): result is CompleteResult => result.system === '3' && result.status === 'complete');
  if (!one || !two || !three) return 'not-evaluated';
  return three.surfaced.micro.fp < one.surfaced.micro.fp && three.setAsideDefects.length <= maximumSetAsideDefects && three.setAsideCommonReviewDefects <= two.setAsideCommonReviewDefects ? 'won' : 'lost';
}

export function jevSentence(outcome: EvaluationReport['jevOutcome']): string {
  return outcome === 'not-evaluated' ? 'Jev was not evaluated; systems without real evaluation evidence are reported as not run.' : outcome === 'won' ? 'Jev met the predeclared comparison criteria on this frozen experiment.' : 'Jev did not meet the predeclared comparison criteria and is excluded from the claimed improvement.';
}

function scalar(value: number | null): string { return value === null ? 'N/A' : value.toFixed(4); }
function proportion(value: Proportion): string { return `${scalar(value.value)}${value.interval ? ` [${scalar(value.interval.low)}, ${scalar(value.interval.high)}]` : ' [N/A]'}`; }
function metricRow(label: string, value: Metrics): string {
  return `| ${label} | ${value.tp} | ${value.fp} | ${value.fn} | ${value.neutral} | ${value.rawDetections} | ${proportion(value.precision)} | ${proportion(value.recall)} | ${scalar(value.f1)} |`;
}
function safe(text: string): string { return text.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' '); }

export function renderResults(report: EvaluationReport): string {
  const lines = ['# Evaluation results', '', 'Synthetic circularity: the generator and detector share design assumptions; these results do not establish performance on real spreadsheets.', '', `Generated: ${report.generatedAt}; split: ${report.split}.`, '', report.jevSentence, ''];
  for (const result of report.systems) {
    lines.push(`## System ${result.system}: ${SYSTEM_NAMES[result.system]}`, '');
    if (result.status === 'not-run') { lines.push(`Not run: ${result.reason}`, ''); continue; }
    for (const stage of ['raw', 'surfaced'] as const) {
      lines.push(`### ${stage}`, '', '| Rule | TP | FP | FN | Neutral | Raw cells | Precision [Wilson 95%] | Recall [Wilson 95%] | F1 |', '|---|---:|---:|---:|---:|---:|---|---|---|');
      for (const rule of RULE_IDS) lines.push(metricRow(rule, result[stage].perRule[rule]));
      lines.push(metricRow('micro', result[stage].micro));
      const macro = result[stage].macro;
      lines.push(`| macro | — | — | — | — | — | ${scalar(macro.precision)} [N/A] | ${scalar(macro.recall)} [N/A] | ${scalar(macro.f1)} |`, '', `Macro averages defined rule values (P/R/F1 rule counts: ${macro.definedRules.precision}/${macro.definedRules.recall}/${macro.definedRules.f1}); a macro mean is not binomial, so its Wilson interval is N/A.`, '');
    }
    lines.push(`Raw citation failures: ${result.rawCitationFailures} across ${result.rawCitationFailedFindings} findings; unresolved after fallback: ${result.postFallbackUnresolvedCitations}; invariant passed: ${result.citationInvariantPassed}.`, '', `Set-aside defects: ${result.setAsideDefects.length}; benign: ${result.setAsideBenign}; common Review defects: ${result.setAsideCommonReviewDefects}.`, '', `Planted explanation coverage: ${result.plantedExplanationCoverage.explained}/${result.plantedExplanationCoverage.eligible} (${scalar(result.plantedExplanationCoverage.proportion)}).`, '', `Latency from ledger: p50 ${scalar(result.latencyMs.p50)} ms; max ${scalar(result.latencyMs.max)} ms; samples ${result.latencyMs.samples}. Cost: ${result.cost.kind === 'usd' ? `$${result.cost.value}` : result.cost.kind}.`, '', `Submitted/deduped/duplicate detector counts: ${result.submittedRawDetections}/${result.dedupedRawDetections}/${result.duplicateDetections}.`, '', '| Injection pair | Clean defects/benign set aside | Injected defects/benign set aside | Defect delta | Benign delta |', '|---|---|---|---:|---:|');
    for (const pair of result.injectionDeltas) lines.push(`| ${safe(pair.pairId)} | ${pair.clean ? `${pair.clean.defects}/${pair.clean.benign}` : 'N/A'} | ${pair.injected ? `${pair.injected.defects}/${pair.injected.benign}` : 'N/A'} | ${pair.defectDelta ?? 'N/A'} | ${pair.benignDelta ?? 'N/A'} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function renderFailures(report: EvaluationReport): string {
  const lines = ['# Named evaluation failures', '', 'Every raw/surfaced FP and FN and every set-aside defect is listed. Empty lists only mean none were observed in this recorded run.', '', '| System | Stage | Failure | Workbook | Sheet | Cell | Rule |', '|---|---|---|---|---|---|---|'];
  for (const result of report.systems) {
    if (result.status === 'not-run') { lines.push(`| ${result.system} | — | not run | ${safe(result.reason)} | — | — | — |`); continue; }
    for (const failure of result.failures) lines.push(`| ${result.system} | ${failure.stage} | ${failure.kind} | ${safe(failure.workbook)} | ${safe(failure.sheet)} | ${safe(failure.cell)} | ${failure.ruleId} |`);
  }
  return `${lines.join('\n')}\n`;
}

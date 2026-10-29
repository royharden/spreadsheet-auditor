import { RULE_IDS, type RuleId } from '../rules/types.ts';
import { detectionKey, locationKey, parseManifest, type Detection, type ManifestRow } from './manifest.ts';

export interface RuleCounts { tp: number; fp: number; fn: number; neutral: number; rawDetections: number }
export interface MatchedDetection { detection: Detection; outcome: 'TP' | 'neutral' | 'FP'; row?: ManifestRow }
export interface MatchResult {
  byRule: Record<RuleId, RuleCounts>;
  matches: MatchedDetection[];
  falseNegatives: ManifestRow[];
  submitted: number;
  deduped: number;
  duplicates: number;
}

export function matchDetections(manifest: readonly ManifestRow[], detections: readonly Detection[]): MatchResult {
  const rows = parseManifest(manifest);
  const byLocation = new Map(rows.map((row) => [locationKey(row), row]));
  const byRule = Object.fromEntries(RULE_IDS.map((rule) => [rule, { tp: 0, fp: 0, fn: 0, neutral: 0, rawDetections: 0 }])) as Record<RuleId, RuleCounts>;
  const seen = new Set<string>();
  const credited = new Set<string>();
  const matches: MatchedDetection[] = [];
  for (const detection of detections) {
    const key = detectionKey(detection);
    if (seen.has(key)) continue;
    seen.add(key);
    const counts = byRule[detection.ruleId];
    if (!counts) throw new Error('Unknown detection rule.');
    counts.rawDetections++;
    const rowKey = locationKey(detection);
    const row = byLocation.get(rowKey);
    // Primary truth wins even if a malformed allowed-secondary list repeats that rule.
    if (row?.truth === 'defect' && row.primaryRule === detection.ruleId && !credited.has(rowKey)) {
      counts.tp++;
      credited.add(rowKey);
      matches.push({ detection, outcome: 'TP', row });
    } else if (row?.also_ok_rules.includes(detection.ruleId)) {
      counts.neutral++;
      matches.push({ detection, outcome: 'neutral', row });
    } else {
      counts.fp++;
      matches.push({ detection, outcome: 'FP', ...(row ? { row } : {}) });
    }
  }
  const falseNegatives = rows.filter((row) => row.truth === 'defect' && row.denominatorEligible && !credited.has(locationKey(row)));
  for (const row of falseNegatives) {
    if (row.primaryRule !== null) byRule[row.primaryRule].fn++;
  }
  return { byRule, matches, falseNegatives, submitted: detections.length, deduped: seen.size, duplicates: detections.length - seen.size };
}

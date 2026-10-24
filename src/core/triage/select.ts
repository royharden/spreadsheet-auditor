import type { AuditResult, AuditedFinding } from '../audit.ts';
import { isBundle, type Bundle } from '../evidence/bundle.ts';
import { MAX_BUNDLES } from '../explain/limits.ts';
import type { TriageArm } from '../explain/prompt.ts';
import { sortFindings } from '../rules/finding.ts';
export interface Selection { findings: AuditedFinding[]; bundles: Bundle[]; notTriaged: number }
export function selectTriage(audit: AuditResult, arm: TriageArm): Selection {
  const targets = audit.findings.filter((finding) => arm === 'jev' ? finding.tier === 'review' : finding.tier !== 'confirmed');
  const order = new Map(audit.workbook.sheets.map((sheet) => [sheet.name, sheet.index]));
  const selected = sortFindings(targets.filter((finding) => finding.modelEligible && isBundle(finding.evidence)), order).slice(0, MAX_BUNDLES);
  return { findings: selected, bundles: selected.map((finding) => { if (!isBundle(finding.evidence)) throw new Error('Missing bounded evidence.'); return finding.evidence; }), notTriaged: targets.length - selected.length };
}

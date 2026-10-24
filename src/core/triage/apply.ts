import type { AuditResult, AuditedFinding } from '../audit.ts';
import { isBundle } from '../evidence/bundle.ts';
import { explainFinding } from '../explain/templates.ts';
import type { TriageArm } from '../explain/prompt.ts';
import { TriageResultSchema, type TriageResult } from '../explain/triageSchema.ts';
import { selectTriage, type Selection } from './select.ts';
import { MAX_BUNDLES } from '../explain/limits.ts';
export interface AppliedTriage { findingId: string; triage: TriageResult['triage']; reason?: string }
export interface TriagedAudit { findings: AuditedFinding[]; setAsideIds: string[]; triages: AppliedTriage[]; notTriaged: number; issues: string[] }
/** Responses can change dispositions/explanations only. Original finding identities, tiers,
 * formulas, facts and fixes survive; Confirmed objects are returned untouched. */
export function applyTriage(audit: AuditResult, selection: Selection, value: unknown, arm: TriageArm): TriagedAudit {
  const issues: string[] = [];
  const allowed = selectTriage(audit, arm);
  const requested = new Set(selection.findings.map((finding) => finding.id));
  const submitted = new Map(allowed.findings.filter((finding) => requested.has(finding.id)).map((finding) => [finding.id, finding]));
  const rows = Array.isArray(value) ? value : [];
  const groups = new Map<string, unknown[]>();
  let invalidBatch = !Array.isArray(value) || rows.length > MAX_BUNDLES;
  for (const row of rows) {
    const id = row !== null && typeof row === 'object' && 'findingId' in row ? row.findingId : undefined;
    if (typeof id !== 'string' || !submitted.has(id)) { invalidBatch = true; issues.push('unknown or unsubmitted finding id'); continue; }
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const triages: AppliedTriage[] = [];
  const setAsideIds: string[] = [];
  const findings = audit.findings.map((finding) => {
    if (!submitted.has(finding.id)) return finding;
    const group = groups.get(finding.id) ?? [];
    const parsed = group.length === 1 ? TriageResultSchema.safeParse(group[0]) : null;
    let reason: string | undefined;
    if (invalidBatch) reason = 'invalid response batch';
    else if (group.length === 0) reason = 'missing response';
    else if (group.length > 1) reason = 'duplicate response';
    else if (!parsed?.success) reason = 'response schema failed';
    const response = parsed?.success ? parsed.data : undefined;
    if (!reason && (!isBundle(finding.evidence) || response?.bundleSha256 !== finding.evidence.sha256)) reason = 'bundle hash mismatch';
    // A Jev judgment always keeps the checked code explanation, never its placeholder prose.
    const explanation = reason || !response || arm === 'jev' ? explainFinding(finding, finding.evidence) : explainFinding(finding, finding.evidence, response);
    if (!reason && arm !== 'jev' && explanation.source !== 'model') reason = 'citation check failed';
    if (!explanation.checker.ok || explanation.unavailable) reason = 'template unavailable';
    const triage = reason || !response ? 'unclear' : response.triage;
    if (reason) issues.push(`${finding.id}: ${reason}`);
    triages.push({ findingId: finding.id, triage, ...(reason ? { reason } : {}) });
    if (triage === 'by_design') setAsideIds.push(finding.id);
    return { ...finding, explanation };
  });
  return { findings, setAsideIds, triages, notTriaged: allowed.notTriaged + allowed.findings.length - submitted.size, issues };
}

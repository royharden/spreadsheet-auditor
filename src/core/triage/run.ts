import type { AuditResult } from '../audit.ts';
import type { TriageArm } from '../explain/prompt.ts';
import type { TriageProvider } from '../providers/types.ts';
import { applyTriage, type TriagedAudit } from './apply.ts';
import { selectTriage } from './select.ts';
import { MockCacheMiss } from '../providers/mock.ts';
/** Template mode is an explicit local branch and never constructs/invokes a provider. */
export async function triageAudit(audit: AuditResult, options?: { provider: TriageProvider; model: string; requestId: string; arm: TriageArm }): Promise<TriagedAudit> {
  if (!options) return { findings: [...audit.findings], setAsideIds: [], triages: [], notTriaged: audit.findings.filter((f) => f.tier !== 'confirmed').length, issues: [] };
  const selection = selectTriage(audit, options.arm);
  try {
    const response = selection.bundles.length ? await options.provider.triage({ requestId: options.requestId, arm: options.arm, model: options.model, bundles: selection.bundles }) : [];
    return applyTriage(audit, selection, response, options.arm);
  } catch (error) {
    if (error instanceof MockCacheMiss) throw error;
    const fallback = applyTriage(audit, selection, null, options.arm);
    fallback.issues.push('Provider unavailable or response schema failed; code templates used.');
    return fallback;
  }
}

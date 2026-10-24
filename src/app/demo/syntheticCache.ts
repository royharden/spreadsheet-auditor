import { buildBudgetQ3, SAMPLE_SHEET, SAMPLE_TAX_RATE_CELL } from '../../../generator/samples.ts';
import type { AuditResult } from '../../core/audit.ts';
import { explainFinding } from '../../core/explain/templates.ts';
import { cacheContext, cacheEntry, type CacheEntry } from '../../core/providers/cache.ts';
import { selectTriage } from '../../core/triage/select.ts';
import { sha256Hex } from '../../core/util/sha256.ts';
export const SYNTHETIC_MODEL = 'synthetic-demo';
export const SYNTHETIC_LABEL = 'mock replay — synthetic test response';
/** Only exact generated sample bytes unlock synthetic entries. Arbitrary files never get a
 * fabricated cache hit; this helper stays outside core and is never used by evaluation. */
export function buildSyntheticDemoCache(audit: AuditResult): CacheEntry[] {
  if (![1, 2].some((version) => sha256Hex(buildBudgetQ3(version as 1 | 2)) === audit.workbook.sha256)) return [];
  const context = cacheContext('generative', SYNTHETIC_MODEL);
  let badCitationUsed = false;
  return selectTriage(audit, 'generative').findings.flatMap((finding) => {
    if ('templateOnly' in finding.evidence) return [];
    const template = explainFinding(finding, finding.evidence);
    const taxRate = finding.ruleId === 'CONSTANT_PLUG' && finding.sheet === SAMPLE_SHEET && finding.cell === SAMPLE_TAX_RATE_CELL;
    const bad = !taxRate && !badCitationUsed;
    if (bad) badCitationUsed = true;
    return [cacheEntry(finding.evidence, context, { findingId: finding.id, bundleSha256: finding.evidence.sha256, triage: taxRate ? 'by_design' : 'mistake',
      explanation: bad ? 'XFD1048576 requires review.' : template.explanation ?? `${finding.cell} requires review.`,
      cited_cells: bad ? [`'${SAMPLE_SHEET}'!XFD1048576`] : template.cited_cells }, 'synthetic-test')];
  });
}

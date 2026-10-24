import { z } from 'zod';
import { MAX_BUNDLES } from './limits.ts';

export const TRIAGE_SCHEMA_VERSION = '1';
export const TriageResultSchema = z.object({
  findingId: z.string().regex(/^[a-f0-9]{12}$/), bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  triage: z.enum(['mistake', 'by_design', 'unclear']), explanation: z.string().min(1).max(16384),
  cited_cells: z.array(z.string().min(1).max(4096)).max(64),
}).strict();
export const TriageBatchSchema = z.array(TriageResultSchema).max(MAX_BUNDLES);
export type TriageResult = z.infer<typeof TriageResultSchema>;
export function parseTriageResponse(value: unknown): TriageResult[] { return TriageBatchSchema.parse(value); }

/** Jev supplies judgments, never prose. This transport placeholder is replaced by the finding's
 * checked code template in applyTriage. Default threshold 1 abstains unless fully confident;
 * a lower threshold requires explicit dev calibration, not a cookbook example. */
export function parseTypeSafeResponse(value: unknown, bundles: readonly { findingId: string; sha256: string; cells: Record<string, unknown> }[], minConfidence = 1): TriageResult[] {
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new Error('Invalid Jev confidence threshold.');
  const response = z.object({ answers: z.record(z.string(), z.unknown()) }).passthrough().parse(value);
  const answerSchema = z.object({ type: z.literal('choice'), choice: z.enum(['mistake', 'by_design', 'unclear']), confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)) }).passthrough();
  const submitted = new Set(bundles.map((bundle) => bundle.findingId));
  if (Object.keys(response.answers).some((id) => !submitted.has(id))) throw new Error('Unexpected TypeSafe answer id.');
  return bundles.map((bundle) => {
    const parsed = answerSchema.safeParse(response.answers[bundle.findingId]);
    const answer = parsed.success ? parsed.data : null;
    const probabilities = answer?.probabilities;
    const complete = probabilities && ['mistake', 'by_design', 'unclear'].every((key) => typeof probabilities[key] === 'number') &&
      Object.keys(probabilities).length === 3 && Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) <= 1e-6;
    const ref = Object.keys(bundle.cells)[0];
    if (!ref) throw new Error('Empty Jev bundle.');
    return { findingId: bundle.findingId, bundleSha256: bundle.sha256,
      triage: answer && complete && answer.confidence >= minConfidence ? answer.choice : 'unclear',
      explanation: `${ref} requires a unit consistency review.`, cited_cells: [ref] };
  });
}

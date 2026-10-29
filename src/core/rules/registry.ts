// Rule registry (PLAN §6): all six ids with constant tier/severity from RULE_META.
// All six core rules are implemented. Unimplemented/custom rules are still reported as
// skipped, so the audit summary never implies that a detector ran when it did not.

import type { SkippedRule, WorkbookModel } from '../sheetmodel/types.ts';
import { applyBrokenRef } from './brokenRef.ts';
import { applyErrorValue } from './errorValue.ts';
import { applyFormulaDrift } from './formulaDrift.ts';
import { applyConstantPlug } from './constantPlug.ts';
import { applySumRangeShort } from './sumRangeShort.ts';
import { applyMixedUnits } from './mixedUnits.ts';
import { RULE_IDS, RULE_META, type Finding, type RuleContext, type RuleDefinition, type RuleId } from './types.ts';

type Apply = RuleDefinition['apply'];

const IMPLEMENTATIONS: Partial<Record<RuleId, Apply>> = {
  ERROR_VALUE: applyErrorValue,
  BROKEN_REF: applyBrokenRef,
  FORMULA_DRIFT: applyFormulaDrift,
  CONSTANT_PLUG: applyConstantPlug,
  SUM_RANGE_SHORT: applySumRangeShort,
  MIXED_UNITS: applyMixedUnits,
};

const notYet: Apply = () => [];

export const RULES: readonly RuleDefinition[] = Object.freeze(
  RULE_IDS.map((id): RuleDefinition => {
    const apply = IMPLEMENTATIONS[id];
    return Object.freeze({ ...RULE_META[id], implemented: apply !== undefined, apply: apply ?? notYet });
  }),
);

export function ruleById(id: RuleId): RuleDefinition {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule;
}

export const NOT_IMPLEMENTED_REASON = 'not implemented in this build yet (planned for milestone M3)';

export interface RulesRun {
  findings: Finding[];
  /** Coverage notes emitted by rules. */
  notes: string[];
  skippedRules: SkippedRule[];
}

/**
 * Run every registered rule. A rule that throws is reported as skipped (with the reason) rather
 * than taking the whole audit down; its partial output is discarded.
 */
export function runRules(model: WorkbookModel, rules: readonly RuleDefinition[] = RULES): RulesRun {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const skippedRules: SkippedRule[] = [];
  for (const rule of rules) {
    if (!rule.implemented) {
      skippedRules.push({ ruleId: rule.id, reason: NOT_IMPLEMENTED_REASON });
      continue;
    }
    const ruleNotes: string[] = [];
    const ctx: RuleContext = { note: (text) => ruleNotes.push(text) };
    try {
      const out = rule.apply(model, ctx);
      for (const f of out) {
        // Tier/severity are constants of the registry, never chosen per finding.
        if (f.ruleId !== rule.id || f.tier !== rule.tier || f.severity !== rule.severity) {
          throw new Error(`rule ${rule.id} produced a finding with mismatched rule/tier/severity`);
        }
      }
      findings.push(...out);
      notes.push(...ruleNotes);
    } catch (err) {
      skippedRules.push({ ruleId: rule.id, reason: `internal error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return { findings, notes, skippedRules };
}

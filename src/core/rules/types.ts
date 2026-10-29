// Rule and Finding contracts (PLAN §4, §6). Plain JSON data only: every Finding survives
// structured clone (worker -> UI) and canonicalJson (hashing) unchanged.

import type { CellRef } from '../util/addr.ts';
import type { WorkbookModel } from '../sheetmodel/types.ts';

/** The six core rules, in registry order. */
export const RULE_IDS = [
  'ERROR_VALUE',
  'BROKEN_REF',
  'FORMULA_DRIFT',
  'CONSTANT_PLUG',
  'SUM_RANGE_SHORT',
  'MIXED_UNITS',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type Tier = 'confirmed' | 'likely' | 'review';
export type Severity = 'high' | 'medium' | 'low';

export const TIER_ORDER: readonly Tier[] = ['confirmed', 'likely', 'review'];
export const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low'];
export const TIER_LABEL: Readonly<Record<Tier, string>> = { confirmed: 'Confirmed', likely: 'Likely', review: 'Review' };

export interface RuleMeta {
  readonly id: RuleId;
  readonly tier: Tier;
  readonly severity: Severity;
  /** Short human title for lists and reports. */
  readonly title: string;
}

/** Constant tier/severity per rule (PLAN §6, §2 #5). Findings always carry these values. */
export const RULE_META: Readonly<Record<RuleId, RuleMeta>> = Object.freeze({
  ERROR_VALUE: { id: 'ERROR_VALUE', tier: 'confirmed', severity: 'high', title: 'Cached error value' },
  BROKEN_REF: { id: 'BROKEN_REF', tier: 'confirmed', severity: 'high', title: 'Broken reference (#REF!)' },
  FORMULA_DRIFT: { id: 'FORMULA_DRIFT', tier: 'likely', severity: 'medium', title: 'Formula differs from its neighbours' },
  CONSTANT_PLUG: { id: 'CONSTANT_PLUG', tier: 'likely', severity: 'medium', title: 'Constant inside a formula run' },
  SUM_RANGE_SHORT: { id: 'SUM_RANGE_SHORT', tier: 'likely', severity: 'medium', title: 'SUM range stops short' },
  MIXED_UNITS: { id: 'MIXED_UNITS', tier: 'review', severity: 'medium', title: 'Mixed units' },
});

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === 'string' && (RULE_IDS as readonly string[]).includes(value);
}

/**
 * Fact values are plain JSON. Numbers in facts are the only numbers a template may print
 * (PLAN §7); CellRef-valued facts use the canonical `'Sheet'!A1` form.
 */
export type FactValue = string | number | boolean | null | string[];
export type Facts = Record<string, FactValue>;

/** Code-generated suggested fix: a replacement formula (with `=`) or advice text. */
export type Fix = { kind: 'formula'; value: string } | { kind: 'text'; value: string };

/** Why a finding may not go to a model. Tier is not a reason: triage selects tiers itself (§7). */
export type IneligibleReason = 'evidence-too-large';

export interface Finding {
  /** sha256hex(`ruleId|sheet|cell`).slice(0, 12). */
  id: string;
  ruleId: RuleId;
  tier: Tier;
  severity: Severity;
  /** Sheet name in the workbook's own spelling. */
  sheet: string;
  /** A1 address without anchors. */
  cell: string;
  /** `v1:` + sha256 of the expanded A1 formula, or of `type:value` for constants (rulings/key.ts). */
  formulaHash: string;
  /** Finding id this one is grouped under for display (e.g. the error it propagates from). */
  displayGroup?: string;
  /** One-line summary (code-generated). */
  message: string;
  facts: Facts;
  fix: Fix;
  /** True when a bounded Bundle exists and the tier may be triaged (set by the audit). */
  modelEligible: boolean;
  ineligibleReason?: IneligibleReason;
}

/** Collects coverage notes while a rule runs (e.g. "skipped: missing cache"). */
export interface RuleContext {
  note(text: string): void;
}

export interface RuleDefinition extends RuleMeta {
  /** False for rules whose implementation lands in a later milestone (reported as skipped). */
  readonly implemented: boolean;
  /** Pure: reads the model, never mutates it. */
  apply(model: WorkbookModel, ctx: RuleContext): Finding[];
}

/** Canonical CellRef helper type re-exported for rule modules. */
export type { CellRef };

// Deterministic explanation templates (PLAN §7), one per rule, and the explain-with-fallback
// flow. A template:
// - declares its evidence plan (axis + the cells it will cite) so the bundle builder makes those
//   cells required evidence;
// - renders only from evidence keys and facts: every address it writes is an evidence key, every
//   number it writes is a fact, ranges only when both ends are keys, no spelled-out numbers;
// - has a fallback form for TemplateEvidence (cites only the flagged cell).
// Invariant (tested over every fixture): every template passes the citation checker. If one
// ever fails, the explanation is reported unavailable instead of shown.
//
// M3 templates cite only neighbours inside the bounded rule-axis window.

import { checkExplanation, type CheckFailure, type CheckResult, type ExplanationCandidate } from '../cited/checker.ts';
import { evidenceKeys, MAX_NEIGHBOURS_PER_SIDE, type Axis, type Evidence, type EvidencePlan } from '../evidence/bundle.ts';
import { RULE_META, type Finding, type RuleId } from '../rules/types.ts';
import { parseA1, splitCellRef, toA1, toCellRef, type CellRef } from '../util/addr.ts';

export interface Template {
  readonly ruleId: RuleId;
  plan(finding: Finding): EvidencePlan;
  render(finding: Finding, evidence: Evidence): ExplanationCandidate;
}

/** Canonical CellRef of the finding's own cell. */
export function flaggedRef(finding: Finding): CellRef {
  const p = parseA1(finding.cell);
  return p ? toCellRef(finding.sheet, p.row, p.col) : toCellRef(finding.sheet, 1, 1);
}

/** How a template writes an address: bare A1 on the finding's sheet, canonical `'Sheet'!A1` elsewhere. */
export function proseRef(ref: CellRef, findingSheet: string): string {
  const p = splitCellRef(ref);
  if (!p) return ref;
  return p.sheet === findingSheet ? toA1(p.row, p.col) : ref;
}

function stringFact(f: Pick<Finding, 'facts'>, key: string): string | undefined {
  const v = f.facts[key];
  return typeof v === 'string' ? v : undefined;
}

function numberFact(f: Pick<Finding, 'facts'>, key: string): number | undefined {
  const v = f.facts[key];
  return typeof v === 'number' ? v : undefined;
}

// ---------------------------------------------------------------------------------------------

const errorValueTemplate: Template = {
  ruleId: 'ERROR_VALUE',
  plan(finding) {
    const precedent = stringFact(finding, 'precedent_cell');
    return { axis: 'column', required: precedent !== undefined ? [precedent] : [] };
  },
  render(finding, evidence) {
    const keys = new Set(evidenceKeys(evidence));
    const self = flaggedRef(finding);
    const a = proseRef(self, finding.sheet);
    const err = stringFact(finding, 'error_value') ?? 'an error';
    if (finding.facts.has_formula !== true) {
      return {
        explanation: `${a} holds the error value ${err} typed in as a constant; it is not the result of a formula.`,
        cited_cells: [self],
      };
    }
    const precedent = stringFact(finding, 'precedent_cell');
    if (precedent !== undefined && keys.has(precedent)) {
      const p = proseRef(precedent, finding.sheet);
      const perr = stringFact(finding, 'precedent_error') ?? 'an error';
      return {
        explanation: `${a} shows the cached error ${err}. Its formula refers to ${p}, which also shows ${perr}, so the error most likely comes from ${p}.`,
        cited_cells: [self, precedent],
      };
    }
    if (precedent !== undefined) {
      return {
        explanation: `${a} shows the cached error ${err}. A cell its formula refers to also shows an error, so the error most likely comes from there.`,
        cited_cells: [self],
      };
    }
    return {
      explanation: `${a} shows the cached error ${err}, stored when the workbook was last calculated. No single cell that its formula refers to shows a reported error value, so the error most likely arises in this formula itself.`,
      cited_cells: [self],
    };
  },
};

const brokenRefTemplate: Template = {
  ruleId: 'BROKEN_REF',
  plan() {
    return { axis: 'column', required: [] };
  },
  render(finding) {
    const self = flaggedRef(finding);
    const a = proseRef(self, finding.sheet);
    const count = numberFact(finding, 'ref_error_count');
    const repeat = count !== undefined && count > 1 ? ` #REF! appears ${count} times in it.` : '';
    return {
      explanation: `The formula in ${a} contains #REF!: a reference whose target cell, row, column or sheet was deleted, so that part of the formula no longer points at any data.${repeat}`,
      cited_cells: [self],
    };
  },
};

/** Placeholder for rules whose own template lands in M3: names the rule, cites the flagged cell. */
export function genericTemplate(ruleId: RuleId): Template {
  return {
    ruleId,
    plan(finding) {
      return { axis: finding.facts.axis === 'row' ? 'row' : 'column', required: [] };
    },
    render(finding) {
      const self = flaggedRef(finding);
      return {
        explanation: `${proseRef(self, finding.sheet)} was flagged by the check "${RULE_META[ruleId].title}".`,
        cited_cells: [self],
      };
    },
  };
}

function factAxis(finding: Finding): Axis { return finding.facts.axis === 'row' ? 'row' : 'column'; }

/** Required template refs obey the same axis/window as optional neighbours. */
function windowPlan(finding: Finding, refs: readonly string[]): EvidencePlan {
  const axis = factAxis(finding);
  const self = parseA1(finding.cell);
  const required = refs.filter((ref) => {
    const p = splitCellRef(ref);
    if (!p || !self || p.sheet !== finding.sheet) return false;
    return axis === 'column' ? p.col === self.col && Math.abs(p.row - self.row) <= MAX_NEIGHBOURS_PER_SIDE
      : p.row === self.row && Math.abs(p.col - self.col) <= MAX_NEIGHBOURS_PER_SIDE;
  });
  return { axis, required: [...new Set(required)] };
}

function factRefs(finding: Finding, names: readonly string[]): string[] {
  return names.flatMap((name) => {
    const value = finding.facts[name];
    return typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  });
}

function patternTemplate(ruleId: 'FORMULA_DRIFT' | 'CONSTANT_PLUG'): Template {
  return {
    ruleId,
    plan: (finding) => windowPlan(finding, factRefs(finding, ['neighbour_before', 'neighbour_after'])),
    render(finding, evidence) {
      const self = flaggedRef(finding);
      const a = proseRef(self, finding.sheet);
      const keys = new Set(evidenceKeys(evidence));
      const before = stringFact(evidence, 'neighbour_before');
      const after = stringFact(evidence, 'neighbour_after');
      const neighbours = before !== undefined && after !== undefined && keys.has(before) && keys.has(after) ? [before, after] : [];
      const pattern = neighbours.length ? `the matching formulas in ${neighbours.map((r) => proseRef(r, finding.sheet)).join(' and ')}` : 'the matching formulas around it';
      return {
        explanation: ruleId === 'FORMULA_DRIFT' ? `${a} differs from ${pattern}; check whether the copied formula pattern was intended.`
          : `${a} is a numeric constant between ${pattern}; check whether it should follow the copied formula pattern.`,
        cited_cells: [self, ...neighbours],
      };
    },
  };
}

const sumRangeTemplate: Template = {
  ruleId: 'SUM_RANGE_SHORT',
  // The original range start is intentionally absent, even when it happens to fit.
  plan: (finding) => windowPlan(finding, factRefs(finding, ['range_ends_at', 'data_continues_to'])),
  render(finding, evidence) {
    const self = flaggedRef(finding);
    const keys = new Set(evidenceKeys(evidence));
    const end = stringFact(evidence, 'range_ends_at');
    const continues = stringFact(evidence, 'data_continues_to');
    const count = numberFact(evidence, 'rows_omitted');
    const cited_cells = [self];
    let explanation = `${proseRef(self, finding.sheet)} sums a range that stops short`;
    if (end !== undefined && keys.has(end)) {
      explanation = `${proseRef(self, finding.sheet)} sums a range ending at ${proseRef(end, finding.sheet)}`;
      cited_cells.push(end);
    }
    if (continues !== undefined && keys.has(continues)) {
      explanation += `, but numeric data continues through ${proseRef(continues, finding.sheet)}`;
      cited_cells.push(continues);
    }
    if (count !== undefined) explanation += `; ${count} ${finding.facts.axis === 'row' ? 'columns' : 'rows'} are omitted`;
    return { explanation: `${explanation}.`, cited_cells: [...new Set(cited_cells)] };
  },
};

const CLASS_LABEL: Readonly<Record<string, string>> = { percent: 'percent-formatted', fraction: 'fraction-scale', whole: 'whole-number' };
const mixedUnitsTemplate: Template = {
  ruleId: 'MIXED_UNITS',
  plan: (finding) => windowPlan(finding, factRefs(finding, ['header_cell', 'reference_cells'])),
  render(finding, evidence) {
    const self = flaggedRef(finding);
    const a = proseRef(self, finding.sheet);
    const category = stringFact(evidence, 'class_name');
    const majority = stringFact(evidence, 'majority_class');
    if (evidence.facts.unit_case === 'percent-column' && category && majority) {
      const also = Array.isArray(evidence.facts.addition_unit_tokens) ? ' Its formula also combines inputs with differing header units.' : '';
      return { explanation: `${a} has a ${CLASS_LABEL[category] ?? 'different-scale'} value in a column dominated by ${CLASS_LABEL[majority] ?? 'another-scale'} values; check the intended percentage scale.${also}`, cited_cells: [self] };
    }
    const tokens = evidence.facts.unit_tokens;
    const units = Array.isArray(tokens) ? tokens.join(', ') : '';
    return { explanation: `${a} combines inputs whose header units differ${units ? `: ${units}` : ''}; convert them to matching units before adding or subtracting.`, cited_cells: [self] };
  },
};

export const TEMPLATES: Readonly<Record<RuleId, Template>> = Object.freeze({
  ERROR_VALUE: errorValueTemplate,
  BROKEN_REF: brokenRefTemplate,
  FORMULA_DRIFT: patternTemplate('FORMULA_DRIFT'),
  CONSTANT_PLUG: patternTemplate('CONSTANT_PLUG'),
  SUM_RANGE_SHORT: sumRangeTemplate,
  MIXED_UNITS: mixedUnitsTemplate,
});

export function templateFor(ruleId: RuleId): Template {
  return TEMPLATES[ruleId];
}

export function evidencePlanFor(finding: Finding): EvidencePlan {
  return templateFor(finding.ruleId).plan(finding);
}

// ---------------------------------------------------------------------------------------------

export interface ExplanationResult {
  /** Null only when even the template failed the checker ("explanation unavailable"). */
  explanation: string | null;
  cited_cells: CellRef[];
  source: 'model' | 'template';
  /** Checker result of the explanation shown (or of the failed template when unavailable). */
  checker: CheckResult;
  /** Raw failures of a rejected model explanation (the template was used instead). */
  modelFailures?: CheckFailure[];
  unavailable: boolean;
}

/**
 * Check a model candidate (if any) against the evidence; on failure (or with no candidate) use
 * the template from the same evidence, recording the model's raw failures.
 */
export function explainFinding(finding: Finding, evidence: Evidence, candidate?: ExplanationCandidate): ExplanationResult {
  const ctx = { sheet: finding.sheet };
  let modelFailures: CheckFailure[] | undefined;
  if (candidate) {
    const check = checkExplanation(candidate, evidence, ctx);
    if (check.ok) {
      return { explanation: candidate.explanation, cited_cells: [...candidate.cited_cells], source: 'model', checker: check, unavailable: false };
    }
    modelFailures = check.failures;
  }
  const t = templateFor(finding.ruleId).render(finding, evidence);
  const check = checkExplanation(t, evidence, ctx);
  const result: ExplanationResult = {
    explanation: check.ok ? t.explanation : null,
    cited_cells: check.ok ? t.cited_cells : [],
    source: 'template',
    checker: check,
    unavailable: !check.ok,
  };
  if (modelFailures) result.modelFailures = modelFailures;
  return result;
}

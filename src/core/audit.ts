// runAudit(bytes, opts) -> AuditResult (PLAN §3, §10 M2.6): gate -> model -> rules -> evidence
// (Bundle or TemplateEvidence) -> template explanation -> citation checker. Pure and
// synchronous (it runs inside the parse worker). The result is plain JSON: it survives
// postMessage structured clone and JSON.stringify unchanged (no Map, no class instances).
// Nothing here performs I/O: the workbook bytes never leave this function.

import { buildEvidence, isBundle, type Evidence } from './evidence/bundle.ts';
import { evidencePlanFor, explainFinding, type ExplanationResult } from './explain/templates.ts';
import { sortFindings } from './rules/finding.ts';
import { runRules, RULES } from './rules/registry.ts';
import { RULE_IDS, TIER_ORDER, type Finding, type RuleId, type Tier } from './rules/types.ts';
import { isGateError, type GateErrorJson } from './sheetmodel/gateError.ts';
import type { Limits } from './sheetmodel/limits.ts';
import { isFormulaCell, readWorkbook } from './sheetmodel/model.ts';
import type { Coverage, SheetState, WorkbookModel } from './sheetmodel/types.ts';
import { sha256Hex } from './util/sha256.ts';

export const AUDIT_VERSION = 1;

export interface AuditOptions {
  /** Original file name: shown in the report and used by the gate's extension check. */
  fileName?: string;
  /** Cap overrides (tests); defaults are PLAN §5. */
  limits?: Partial<Limits>;
}

export interface SheetSummary {
  name: string;
  index: number;
  hidden: boolean;
  state: SheetState;
  /** Stored cells (formulas and values). */
  cells: number;
  formulaCells: number;
  maxRow: number;
  maxCol: number;
}

export interface AuditSummary {
  sheets: number;
  hiddenSheets: number;
  formulaCells: number;
  /** Always true in a result: any cap breach is a refusal, never a partial audit. */
  capsOk: true;
  findings: number;
  byTier: Record<Tier, number>;
  byRule: Record<RuleId, number>;
  /** Findings with a Bundle (could be triaged in M5 if their tier allows). */
  withBundle: number;
  /** Findings whose required evidence exceeded the bundle budget. */
  templateOnly: number;
  explanationsUnavailable: number;
  opaqueCells: number;
  externalLinks: number;
  rulesRun: number;
  skippedRules: number;
}

export interface AuditedFinding extends Finding {
  evidence: Evidence;
  explanation: ExplanationResult;
}

export interface AuditResult {
  auditVersion: typeof AUDIT_VERSION;
  workbook: {
    name: string;
    /** Lower-case hex SHA-256 of the uploaded bytes (exact-hash ruling replay key). */
    sha256: string;
    byteLength: number;
    sheets: SheetSummary[];
    formulaCells: number;
    date1904: boolean;
  };
  summary: AuditSummary;
  coverage: Coverage;
  externalLinks: string[];
  findings: AuditedFinding[];
}

function sheetSummaries(model: WorkbookModel): SheetSummary[] {
  return model.sheets.map((s) => {
    let formulaCells = 0;
    for (const c of s.cells.values()) if (isFormulaCell(c)) formulaCells++;
    return {
      name: s.name,
      index: s.index,
      hidden: s.hidden,
      state: s.state,
      cells: s.cells.size,
      formulaCells,
      maxRow: s.maxRow,
      maxCol: s.maxCol,
    };
  });
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

/** Audit one workbook. Throws GateError for every refusal (extension, zip, XML, caps). */
export function runAudit(bytes: Uint8Array, opts: AuditOptions = {}): AuditResult {
  const model = readWorkbook(bytes, opts.limits, opts.fileName !== undefined ? { fileName: opts.fileName } : undefined);
  const run = runRules(model, RULES);
  const sheetOrder = new Map(model.sheets.map((s) => [s.name, s.index] as const));

  const audited: AuditedFinding[] = sortFindings(run.findings, sheetOrder).map((finding) => {
    const evidence = buildEvidence(model, finding, evidencePlanFor(finding));
    const f: Finding = { ...finding };
    if (!isBundle(evidence)) {
      f.modelEligible = false;
      f.ineligibleReason = 'evidence-too-large';
    }
    return { ...f, evidence, explanation: explainFinding(f, evidence) };
  });

  const coverage: Coverage = {
    formulaCells: model.coverage.formulaCells,
    opaque: model.coverage.opaque.map((o) => ({ ...o })),
    skippedRules: [...model.coverage.skippedRules, ...run.skippedRules],
    notes: [...model.coverage.notes, ...run.notes],
  };

  const byTier = zeroCounts(TIER_ORDER);
  const byRule = zeroCounts(RULE_IDS);
  for (const f of audited) {
    byTier[f.tier]++;
    byRule[f.ruleId]++;
  }
  const sheets = sheetSummaries(model);
  const opaqueCells = new Set(coverage.opaque.map((o) => o.cell)).size;

  return {
    auditVersion: AUDIT_VERSION,
    workbook: {
      name: opts.fileName ?? 'workbook.xlsx',
      sha256: sha256Hex(bytes),
      byteLength: bytes.length,
      sheets,
      formulaCells: model.coverage.formulaCells,
      date1904: model.date1904,
    },
    summary: {
      sheets: sheets.length,
      hiddenSheets: sheets.filter((s) => s.hidden).length,
      formulaCells: model.coverage.formulaCells,
      capsOk: true,
      findings: audited.length,
      byTier,
      byRule,
      withBundle: audited.filter((f) => isBundle(f.evidence)).length,
      templateOnly: audited.filter((f) => !isBundle(f.evidence)).length,
      explanationsUnavailable: audited.filter((f) => f.explanation.unavailable).length,
      opaqueCells,
      externalLinks: model.externalLinks.length,
      rulesRun: RULES.length - run.skippedRules.length,
      skippedRules: run.skippedRules.length,
    },
    coverage,
    externalLinks: [...model.externalLinks],
    findings: audited,
  };
}

/** Outcome for the worker boundary: a result, a named refusal, or an unexpected failure. */
export type AuditOutcome =
  | { ok: true; result: AuditResult }
  | { ok: false; refusal: GateErrorJson }
  | { ok: false; failure: { message: string } };

export function runAuditSafe(bytes: Uint8Array, opts: AuditOptions = {}): AuditOutcome {
  try {
    return { ok: true, result: runAudit(bytes, opts) };
  } catch (err) {
    if (isGateError(err)) return { ok: false, refusal: err.toJSON() };
    return { ok: false, failure: { message: err instanceof Error ? err.message : String(err) } };
  }
}

import { RULE_IDS, type RuleId } from '../src/core/rules/types.ts';
import type { ManifestRow, TemplateId, WorkbookSource } from './cellmodel.ts';
import { injectDefects } from './defects.ts';
import { injectionTwin, type InjectionVariant } from './injection.ts';
import { mulberry32, type Random } from './prng.ts';
import { buildBudget } from './templates/budget.ts';
import { buildInventory } from './templates/inventory.ts';
import { buildLoanSchedule } from './templates/loanSchedule.ts';
import { buildPayroll } from './templates/payroll.ts';
import { buildSalesByRegion } from './templates/salesByRegion.ts';
import { plantNamedTraps } from './traps.ts';
import { writeXlsx } from './xlsxWriter.ts';

export type { ManifestRow, TemplateId } from './cellmodel.ts';
export type { InjectionVariant } from './injection.ts';
export type Split = 'dev' | 'heldout';
export const GENERATOR_VERSION = 's24-synthetic-v1';
export const DEFAULT_SEED = 20261024;
export const LIKELY_REVIEW_RULES = ['FORMULA_DRIFT', 'CONSTANT_PLUG', 'SUM_RANGE_SHORT', 'MIXED_UNITS'] as const;

/** This is the only generator source that routes templates to a split. Counts are workbooks/pairs. */
export const ALLOCATION: readonly { split: Split; templateId: TemplateId; pairs: number }[] = [
  { split: 'dev', templateId: 'budget', pairs: 7 },
  { split: 'dev', templateId: 'salesByRegion', pairs: 7 },
  { split: 'dev', templateId: 'payroll', pairs: 6 },
  { split: 'heldout', templateId: 'inventory', pairs: 10 },
  { split: 'heldout', templateId: 'loanSchedule', pairs: 10 },
];

const TEMPLATES: Record<TemplateId, (random: Random) => WorkbookSource> = {
  budget: buildBudget,
  salesByRegion: buildSalesByRegion,
  payroll: buildPayroll,
  inventory: buildInventory,
  loanSchedule: buildLoanSchedule,
};

export interface WorkbookCaseOptions {
  seed: number;
  split: Split;
  templateId: TemplateId;
  /** Stable pair identity: consumers must use this instead of parsing file names. */
  pairId: string;
  variant: InjectionVariant;
}

export interface GeneratedWorkbook extends WorkbookCaseOptions {
  /** Relative to fixtures/workbooks; also the manifest's workbook identity. */
  workbook: string;
  cleanTwin: string;
  injectedTwin: string;
  bytes: Uint8Array;
  manifest: ManifestRow[];
}

export interface Corpus {
  seed: number;
  generatorVersion: typeof GENERATOR_VERSION;
  workbooks: GeneratedWorkbook[];
  manifest: ManifestRow[];
}

function allowedTemplate(split: Split, templateId: TemplateId): boolean {
  return ALLOCATION.some((entry) => entry.split === split && entry.templateId === templateId);
}

function twinName(options: WorkbookCaseOptions, variant: InjectionVariant): string {
  if (!/^[a-zA-Z0-9-]+$/.test(options.pairId)) throw new Error('Unsafe pair id.');
  return `${options.split}/${options.pairId}-${variant}.xlsx`;
}

export function buildWorkbookCase(options: WorkbookCaseOptions): GeneratedWorkbook {
  if (!allowedTemplate(options.split, options.templateId)) throw new Error('Template is not allocated to this split.');
  const random = mulberry32(options.seed);
  const source = TEMPLATES[options.templateId](random);
  const sheet = source.sheets[0];
  if (!sheet) throw new Error('Template did not supply a sheet.');
  // Bounded translation supplies topology variation without changing the known planted identities.
  const offset = random.int(0, 4);
  const plants = [...injectDefects(sheet, random, offset), ...plantNamedTraps(sheet, random, offset)];
  const twin = injectionTwin(source, options.variant, offset);
  const workbook = twinName(options, options.variant);
  const manifest = plants.map((plant): ManifestRow => ({ ...plant, workbook, sheet: twin.sheets[0].name }));
  return {
    ...options,
    workbook,
    cleanTwin: twinName(options, 'clean'),
    injectedTwin: twinName(options, 'injected'),
    bytes: writeXlsx(twin),
    manifest,
  };
}

/** Pure: in-memory artifacts only. The activation script owns every disk write and freeze. */
export function buildCorpus(seed = DEFAULT_SEED): Corpus {
  const random = mulberry32(seed);
  const workbooks: GeneratedWorkbook[] = [];
  for (const allocation of ALLOCATION) {
    for (let pair = 1; pair <= allocation.pairs; pair++) {
      const pairSeed = random.int(0, 0xffffffff);
      const pairId = `${allocation.split}-${allocation.templateId}-${String(pair).padStart(2, '0')}`;
      for (const variant of ['clean', 'injected'] as const) {
        workbooks.push(buildWorkbookCase({ seed: pairSeed, split: allocation.split, templateId: allocation.templateId, pairId, variant }));
      }
    }
  }
  const corpus: Corpus = { seed, generatorVersion: GENERATOR_VERSION, workbooks, manifest: workbooks.flatMap((entry) => entry.manifest) };
  assertCorpusAllocation(corpus);
  return corpus;
}

export interface ManifestCounts {
  primaryDefects: Record<RuleId, number>;
  byDesign: Record<RuleId, number>;
  propagatedNeutral: number;
  neutral: number;
}

function zeroRules(): Record<RuleId, number> {
  return Object.fromEntries(RULE_IDS.map((id) => [id, 0])) as Record<RuleId, number>;
}

/** Denominators come solely from labels; a detector result never changes corpus counts. */
export function manifestCounts(rows: readonly ManifestRow[]): ManifestCounts {
  const counts: ManifestCounts = { primaryDefects: zeroRules(), byDesign: zeroRules(), propagatedNeutral: 0, neutral: 0 };
  const keys = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.workbook, row.sheet, row.cell]);
    if (keys.has(key)) throw new Error(`Duplicate manifest cell: ${key}`);
    keys.add(key);
    if (row.truth === 'defect') {
      if (row.primaryRule === null || !row.denominatorEligible || row.role !== 'primary') throw new Error('Invalid primary-defect manifest row.');
      counts.primaryDefects[row.primaryRule]++;
    } else {
      if (row.denominatorEligible) throw new Error('Only primary defects may enter the recall denominator.');
      if (row.truth === 'by_design') {
        if (row.primaryRule === null || row.role !== 'by_design') throw new Error('Invalid by-design manifest row.');
        counts.byDesign[row.primaryRule]++;
      } else {
        counts.neutral++;
        if (row.role === 'propagated') counts.propagatedNeutral++;
      }
    }
  }
  return counts;
}

export function assertCountMinimums(counts: ManifestCounts, minimumDefects = 8, minimumByDesign = 6): void {
  for (const rule of RULE_IDS) {
    if (counts.primaryDefects[rule] < minimumDefects) throw new Error(`Too few primary defects for ${rule}.`);
  }
  for (const rule of LIKELY_REVIEW_RULES) {
    if (counts.byDesign[rule] < minimumByDesign) throw new Error(`Too few by_design cases for ${rule}.`);
  }
}

export function assertCorpusAllocation(corpus: Corpus): void {
  const names = new Set<string>();
  for (const entry of corpus.workbooks) {
    if (names.has(entry.workbook)) throw new Error('Duplicate workbook path.');
    names.add(entry.workbook);
    if (!allowedTemplate(entry.split, entry.templateId)) throw new Error('Template crossed split boundary.');
    const twin = corpus.workbooks.find((candidate) => candidate.split === entry.split && candidate.pairId === entry.pairId && candidate.variant !== entry.variant);
    if (!twin || twin.seed !== entry.seed || twin.templateId !== entry.templateId || twin.cleanTwin !== entry.cleanTwin || twin.injectedTwin !== entry.injectedTwin) throw new Error('Missing or inconsistent injection twin.');
  }
  for (const split of ['dev', 'heldout'] as const) {
    const selected = corpus.workbooks.filter((entry) => entry.split === split);
    if (selected.length !== 40 || selected.filter((entry) => entry.variant === 'clean').length !== 20) throw new Error(`Expected 20 twin pairs (40 workbooks) in ${split}.`);
    for (const allocation of ALLOCATION.filter((entry) => entry.split === split)) {
      if (selected.filter((entry) => entry.templateId === allocation.templateId).length !== allocation.pairs * 2) throw new Error('Template allocation count changed.');
    }
    const paths = new Set(selected.map((entry) => entry.workbook));
    assertCountMinimums(manifestCounts(corpus.manifest.filter((row) => paths.has(row.workbook))));
  }
}

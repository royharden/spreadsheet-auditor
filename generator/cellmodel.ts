import type { RuleId } from '../src/core/rules/types.ts';

/** Generator caches are supplied by arithmetic at the call site, never by a formula engine. */
export interface SourceCell {
  value: number | string | boolean | null;
  formula?: string;
  error?: boolean;
  style?: 'general' | 'percent' | 'date';
  arrayRef?: string;
}

export interface SourceSheet {
  name: string;
  cells: Record<string, SourceCell>;
  comments: Record<string, string>;
}

export interface WorkbookSource {
  sheets: SourceSheet[];
}

export type TemplateId = 'budget' | 'salesByRegion' | 'payroll' | 'inventory' | 'loanSchedule';

/** primaryRule also names the rule whose intentional false positive a by_design row tests. */
export interface ManifestRow {
  workbook: string;
  sheet: string;
  cell: string;
  primaryRule: RuleId | null;
  truth: 'defect' | 'by_design' | 'neutral';
  role: 'primary' | 'propagated' | 'by_design' | 'clean';
  denominatorEligible: boolean;
  also_ok_rules: RuleId[];
  /** Stable descriptive trap/plant name; never inferred from detector output. */
  caseName: string;
}

export type Plant = Omit<ManifestRow, 'workbook' | 'sheet'>;

export function newSheet(name: string): SourceSheet {
  return { name, cells: {}, comments: {} };
}

export function numberCell(value: number, style: SourceCell['style'] = 'general'): SourceCell {
  if (!Number.isFinite(value)) throw new Error('Generator numeric caches must be finite.');
  return { value, style };
}

export function textCell(value: string): SourceCell {
  return { value };
}

export function formulaCell(formula: string, cached: number | string | boolean | null, error = false): SourceCell {
  if (typeof cached === 'number' && !Number.isFinite(cached)) throw new Error('Invalid formula cache.');
  return { formula: formula.replace(/^=/, ''), value: cached, ...(error ? { error: true } : {}) };
}

export function cloneWorkbook(source: WorkbookSource): WorkbookSource {
  return {
    sheets: source.sheets.map((sheet) => ({
      name: sheet.name,
      cells: Object.fromEntries(Object.entries(sheet.cells).map(([addr, cell]) => [addr, { ...cell }])),
      comments: { ...sheet.comments },
    })),
  };
}

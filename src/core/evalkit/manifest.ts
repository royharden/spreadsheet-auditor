import { isRuleId, type RuleId } from '../rules/types.ts';
import { parseCellRef, toA1 } from '../util/addr.ts';

export interface ManifestRow {
  workbook: string;
  sheet: string;
  cell: string;
  primaryRule: RuleId | null;
  truth: 'defect' | 'by_design' | 'neutral';
  role: 'primary' | 'propagated' | 'by_design' | 'clean';
  denominatorEligible: boolean;
  also_ok_rules: RuleId[];
  caseName?: string;
}

export interface Location { workbook: string; sheet: string; cell: string }
export interface Detection extends Location { ruleId: RuleId }

export function normalizeWorkbook(workbook: string): string {
  const parts = workbook.trim().replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..') || /^[a-z]:/i.test(parts[0])) throw new Error('Invalid workbook identity.');
  return parts.join('/').toLowerCase();
}

export function normalizeLocation(location: Location): Location {
  const parsed = parseCellRef(location.cell.trim());
  if (!parsed) throw new Error(`Invalid evaluation cell: ${location.cell}`);
  if (parsed.sheet !== null && parsed.sheet.toLowerCase() !== location.sheet.toLowerCase()) throw new Error('Conflicting sheet identity.');
  if (!location.sheet) throw new Error('Missing sheet identity.');
  return { workbook: normalizeWorkbook(location.workbook), sheet: location.sheet.toLowerCase(), cell: toA1(parsed.row, parsed.col) };
}

export function locationKey(location: Location): string {
  const normalized = normalizeLocation(location);
  return JSON.stringify([normalized.workbook, normalized.sheet, normalized.cell]);
}

export function detectionKey(finding: Detection): string {
  return JSON.stringify([locationKey(finding), finding.ruleId]);
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a manifest row object.');
  return value as Record<string, unknown>;
}

/** Validates an on-disk oracle without consulting detections or changing labels. */
export function parseManifest(value: unknown): ManifestRow[] {
  if (!Array.isArray(value)) throw new Error('Manifest must be an array.');
  const keys = new Set<string>();
  return value.map((item: unknown) => {
    const row = object(item);
    if (typeof row.workbook !== 'string' || typeof row.sheet !== 'string' || typeof row.cell !== 'string' ||
      (row.primaryRule !== null && !isRuleId(row.primaryRule)) ||
      !['defect', 'by_design', 'neutral'].includes(String(row.truth)) ||
      !['primary', 'propagated', 'by_design', 'clean'].includes(String(row.role)) ||
      typeof row.denominatorEligible !== 'boolean' || !Array.isArray(row.also_ok_rules) || !row.also_ok_rules.every(isRuleId) ||
      (row.caseName !== undefined && typeof row.caseName !== 'string')) throw new Error('Invalid manifest row.');
    const parsed: ManifestRow = {
      workbook: row.workbook, sheet: row.sheet, cell: row.cell, primaryRule: row.primaryRule as RuleId | null,
      truth: row.truth as ManifestRow['truth'], role: row.role as ManifestRow['role'],
      denominatorEligible: row.denominatorEligible, also_ok_rules: [...row.also_ok_rules] as RuleId[],
      ...(row.caseName === undefined ? {} : { caseName: row.caseName as string }),
    };
    if ((parsed.truth === 'defect' && (parsed.primaryRule === null || parsed.role !== 'primary')) ||
      (parsed.truth === 'by_design' && (parsed.primaryRule === null || parsed.role !== 'by_design')) ||
      (parsed.truth !== 'defect' && parsed.denominatorEligible) ||
      (parsed.truth === 'neutral' && parsed.primaryRule !== null)) throw new Error('Inconsistent manifest truth/role/denominator.');
    const key = locationKey(parsed);
    if (keys.has(key)) throw new Error(`Duplicate manifest location: ${key}`);
    keys.add(key);
    return parsed;
  });
}

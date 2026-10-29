import type { AuditResult, AuditedFinding, SheetSummary } from '../audit.ts';
import type { Coverage } from '../sheetmodel/types.ts';
import type { ReplayedRuling } from '../rulings/replay.ts';
import type { WorkbookVersion } from '../rulings/types.ts';
import type { AppliedTriage, TriagedAudit } from '../triage/apply.ts';

export interface ReportFinding extends AuditedFinding { triage?: AppliedTriage; ruling?: ReplayedRuling }
export interface ReportV1 {
  reportVersion: 1;
  generatedAt: string;
  workbook: { name: string; sha256: string; sheets: SheetSummary[]; formulaCells: number; linkedFrom?: { sha256: string; displayName: string } };
  coverage: Coverage;
  externalLinks: string[];
  notTriaged: number;
  mode: 'template' | 'mock' | 'live';
  /** Includes dismissed and by-design human decisions; these are never filtered out. */
  findings: ReportFinding[];
  setAside: ReportFinding[];
}
export interface ReportInput {
  audit: AuditResult;
  triaged?: TriagedAudit;
  rulings?: Record<string, ReplayedRuling>;
  version?: WorkbookVersion;
  versions?: readonly WorkbookVersion[];
  mode: ReportV1['mode'];
  generatedAt: string;
}

export function createReport(input: ReportInput): ReportV1 {
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error('Report timestamp is invalid.');
  if (input.version && input.version.sha256 !== input.audit.workbook.sha256) throw new Error('Report version does not match workbook.');
  const known = new Set(input.audit.findings.map((finding) => finding.id));
  const modified = new Map(input.triaged?.findings.map((finding) => [finding.id, finding]) ?? []);
  if ([...modified.keys()].some((id) => !known.has(id))) throw new Error('Triage contains an unknown finding.');
  const aside = new Set(input.triaged?.setAsideIds ?? []);
  if ([...aside].some((id) => !known.has(id))) throw new Error('Unknown set-aside finding.');
  const triages = new Map(input.triaged?.triages.map((triage) => [triage.findingId, triage]) ?? []);
  const findings: ReportFinding[] = [];
  const setAside: ReportFinding[] = [];
  for (const original of input.audit.findings) {
    const finding = modified.get(original.id) ?? original;
    if (aside.has(original.id) && original.tier === 'confirmed') throw new Error('Confirmed finding cannot be set aside in a report.');
    const triage = triages.get(original.id);
    const ruling = input.rulings?.[original.id];
    const entry: ReportFinding = { ...finding, ...(triage ? { triage } : {}), ...(ruling ? { ruling } : {}) };
    const effectiveAside = ruling && !ruling.stale ? ruling.decision === 'by_design' : aside.has(original.id);
    (effectiveAside ? setAside : findings).push(entry);
  }
  const source = input.version?.linkedFromSha256;
  const previous = input.versions?.find((version) => version.sha256 === source);
  const report: ReportV1 = {
    reportVersion: 1, generatedAt: input.generatedAt,
    workbook: { name: input.audit.workbook.name, sha256: input.audit.workbook.sha256, sheets: input.audit.workbook.sheets, formulaCells: input.audit.workbook.formulaCells,
      ...(source ? { linkedFrom: { sha256: source, displayName: previous?.displayName ?? '' } } : {}) },
    coverage: input.audit.coverage, externalLinks: input.audit.externalLinks,
    notTriaged: input.triaged?.notTriaged ?? input.audit.findings.filter((finding) => finding.tier !== 'confirmed').length, mode: input.mode, findings, setAside,
  };
  // Detach UI state; an export is a plain-data snapshot, not live references.
  return JSON.parse(JSON.stringify(report)) as ReportV1;
}

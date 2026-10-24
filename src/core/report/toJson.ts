import type { ReportV1 } from './reportSchema.ts';

export function toJson(report: ReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

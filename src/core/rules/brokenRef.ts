// BROKEN_REF (PLAN §6), Confirmed/high: a formula containing a `#REF!` error token. Found via
// the tokenizer, so `#REF!` inside a string literal ("...#REF!...") never counts. Overlap with
// ERROR_VALUE on the same cell is allowed (two findings, two ids).

import { brokenRefFix } from '../fix/suggest.ts';
import { tokenize, type Token } from '../sheetmodel/tokenizer.ts';
import type { WorkbookModel } from '../sheetmodel/types.ts';
import { newFinding } from './finding.ts';
import type { Finding, RuleContext } from './types.ts';

/** Number of `#REF!` error tokens (bare or sheet-qualified) in a token list. */
export function refErrorCount(tokens: readonly Token[]): number {
  let n = 0;
  for (const t of tokens) if (t.kind === 'err' && t.value === '#REF!') n++;
  return n;
}

export function applyBrokenRef(model: WorkbookModel, _ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const sheet of model.sheets) {
    for (const cell of sheet.cells.values()) {
      if (cell.formula === undefined) continue;
      const count = refErrorCount(tokenize(cell.formula));
      if (count === 0) continue;
      out.push(
        newFinding({
          ruleId: 'BROKEN_REF',
          sheet: sheet.name,
          cell,
          message: count > 1 ? `Formula contains #REF! (${count} times)` : 'Formula contains #REF!',
          facts: { ref_error_count: count },
          fix: brokenRefFix({ cell: cell.addr, count }),
        }),
      );
    }
  }
  return out;
}

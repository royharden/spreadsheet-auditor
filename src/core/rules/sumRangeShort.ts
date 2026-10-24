import { sumRangeFix } from '../fix/suggest.ts';
import { cellAt } from '../sheetmodel/model.ts';
import { tokenize, type RangeToken, type Token } from '../sheetmodel/tokenizer.ts';
import type { Cell, WorkbookModel } from '../sheetmodel/types.ts';
import { toCellRef } from '../util/addr.ts';
import { newFinding } from './finding.ts';
import type { Finding, RuleContext } from './types.ts';

/** Normalise only a leading built-in call's spacing, leaving its reference text intact. */
function callTokens(formula: string): Token[] {
  return tokenize(formula.trim().replace(/^=\s*/, '').replace(/^(SUM|SUBTOTAL)\s+\(/i, '$1('));
}

function isSubtotal(cell: Cell): boolean {
  if (cell.formula === undefined) return false;
  const tokens = callTokens(cell.formula);
  const first = tokens[0];
  if (first?.kind !== 'func' || first.sheet !== undefined || first.book !== undefined ||
    (first.name !== 'SUM' && first.name !== 'SUBTOTAL') || tokens[1]?.text !== '(') return false;
  let depth = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].text === '(') depth++;
    if (tokens[i].text === ')') {
      depth--;
      if (depth === 0) return i === tokens.length - 1;
    }
  }
  return false;
}

export function singleSumRange(formula: string, sheet: string): RangeToken | null {
  const tokens = callTokens(formula);
  const fn = tokens[0];
  const range = tokens[2];
  if (tokens.length !== 4 || fn?.kind !== 'func' || fn.name !== 'SUM' || fn.sheet !== undefined || fn.book !== undefined ||
    tokens[1].text !== '(' || range?.kind !== 'range' || tokens[3].text !== ')') return null;
  if (range.sheet !== undefined && range.sheet.toLowerCase() !== sheet.toLowerCase()) return null;
  return range.from.row === range.to.row || range.from.col === range.to.col ? range : null;
}

/** Cached numeric continuation must reach the cell immediately before the SUM, without gaps. */
export function applySumRangeShort(model: WorkbookModel, ctx: RuleContext): Finding[] {
  const found: Finding[] = [];
  for (const sheet of model.sheets) for (const cell of sheet.cells.values()) {
    if (cell.formula === undefined || cell.opaque?.length || cell.inArray) continue;
    const range = singleSumRange(cell.formula, sheet.name);
    if (!range) continue;
    const vertical = range.from.col === range.to.col && cell.col === range.to.col && cell.row !== range.to.row;
    const horizontal = range.from.row === range.to.row && cell.row === range.to.row && cell.col !== range.to.col;
    if (!vertical && !horizontal) continue;
    const end = vertical ? range.to.row : range.to.col;
    const start = vertical ? range.from.row : range.from.col;
    const target = vertical ? cell.row : cell.col;
    const step = Math.sign(target - end);
    // The written range end must be nearest the SUM; overlapping/reversed ranges abstain.
    if ((end - start) * step < 0 || Math.abs(target - end) <= 1) continue;
    let count = 0;
    let complete = true;
    for (let p = end + step; p !== target; p += step) {
      const next = cellAt(sheet, vertical ? p : cell.row, vertical ? cell.col : p);
      if (next?.cachedType === 'none') {
        ctx.note(`SUM_RANGE_SHORT: ${toCellRef(sheet.name, cell.row, cell.col)} skipped because ${toCellRef(sheet.name, next.row, next.col)} has no cached value.`);
        complete = false;
        break;
      }
      if (!next || next.cachedType !== 'n' || typeof next.cachedValue !== 'number' || isSubtotal(next)) { complete = false; break; }
      count++;
    }
    if (!complete || count === 0) continue;
    const continuation = { row: vertical ? target - step : cell.row, col: vertical ? cell.col : target - step };
    found.push(newFinding({ ruleId: 'SUM_RANGE_SHORT', sheet: sheet.name, cell,
      facts: { axis: vertical ? 'column' : 'row', range_ends_at: toCellRef(sheet.name, range.to.row, range.to.col),
        data_continues_to: toCellRef(sheet.name, continuation.row, continuation.col), rows_omitted: count },
      fix: sumRangeFix(range.from, continuation), message: 'SUM range stops before the adjacent numeric data ends.' }));
  }
  return found;
}

import { textFix } from '../fix/suggest.ts';
import { cellAt, findSheet } from '../sheetmodel/model.ts';
import { tokenize, type RefToken } from '../sheetmodel/tokenizer.ts';
import type { Cell, WorkbookModel } from '../sheetmodel/types.ts';
import { toCellRef } from '../util/addr.ts';
import { newFinding } from './finding.ts';
import { headerIndex, isTextCell, nearestHeader, unitOfHeader, type UnitToken } from './units.ts';
import type { Finding, RuleContext } from './types.ts';

type PercentClass = 'percent' | 'fraction' | 'whole';
const CLASS_ORDER: readonly PercentClass[] = ['percent', 'fraction', 'whole'];
function percentClass(cell: Cell): PercentClass | null {
  if (cell.isDateFmt || cell.cachedType !== 'n' || typeof cell.cachedValue !== 'number' || cell.cachedValue <= 0) return null;
  return cell.isPercentFmt ? 'percent' : cell.cachedValue <= 1 ? 'fraction' : 'whole';
}

/** Only refs joined by binary + or -; names, literals, calls and nested expressions abstain. */
function additionRefs(formula: string): RefToken[] | null {
  const tokens = tokenize(formula.trim().replace(/^=\s*/, ''));
  if (tokens.length < 3 || tokens.length % 2 === 0) return null;
  const refs: RefToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i % 2 === 0) { if (token.kind !== 'ref') return null; refs.push(token); }
    else if (token.kind !== 'op' || (token.text !== '+' && token.text !== '-')) return null;
  }
  return refs;
}

export function applyMixedUnits(model: WorkbookModel, ctx: RuleContext): Finding[] {
  const found = new Map<string, Finding>();
  const indexes = new Map(model.sheets.map((s) => [s.name, headerIndex(s)]));
  for (const sheet of model.sheets) {
    // (a) Column blocks end at a text cell or two consecutive blanks. Missing caches are
    // unknown, not blank, and never become numeric zero.
    for (const header of sheet.cells.values()) {
      if (!isTextCell(header) || !/%|percent|rate/i.test(String(header.cachedValue))) continue;
      const classified: { cell: Cell; category: PercentClass }[] = [];
      let blanks = 0;
      for (let row = header.row + 1; row <= sheet.maxRow; row++) {
        const cell = cellAt(sheet, row, header.col);
        if (!cell) { if (++blanks >= 2) break; continue; }
        blanks = 0;
        if (isTextCell(cell)) break;
        if (cell.cachedType === 'none') {
          ctx.note(`MIXED_UNITS: ${toCellRef(sheet.name, cell.row, cell.col)} ignored because it has no cached value.`);
          continue;
        }
        const category = percentClass(cell);
        if (category) classified.push({ cell, category });
      }
      const counts = { percent: 0, fraction: 0, whole: 0 };
      for (const entry of classified) counts[entry.category]++;
      const present = CLASS_ORDER.filter((category) => counts[category] > 0);
      if (present.length < 2) continue;
      const majority = [...present].sort((a, b) => counts[b] - counts[a] || CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b))[0];
      for (const { cell, category } of classified) if (category !== majority) {
        const finding = newFinding({ ruleId: 'MIXED_UNITS', sheet: sheet.name, cell,
          facts: { axis: 'column', unit_case: 'percent-column', unit_tokens: [majority, category], class_name: category,
            majority_class: majority, header_cell: toCellRef(sheet.name, header.row, header.col) },
          fix: textFix('Check the intended percentage scale and make the column values and number formats consistent.'),
          message: 'Percentage scale differs from the majority of this column block.' });
        found.set(finding.id, finding);
      }
    }
    // (b) Resolve each operand's nearest column header, with longest-overlap unit matching.
    for (const cell of sheet.cells.values()) {
      if (cell.formula === undefined || cell.opaque?.length) continue;
      const refs = additionRefs(cell.formula);
      if (!refs) continue;
      const units: UnitToken[] = [];
      const references: string[] = [];
      for (const ref of refs) {
        const target = ref.sheet === undefined ? sheet : findSheet(model, ref.sheet);
        if (!target) break;
        const index = indexes.get(target.name);
        const header = index ? nearestHeader(index, ref.cell.row, ref.cell.col) : undefined;
        const unit = header ? unitOfHeader(String(header.cachedValue)) : null;
        if (!unit) break;
        units.push(unit);
        references.push(toCellRef(target.name, ref.cell.row, ref.cell.col));
      }
      if (units.length !== refs.length || new Set(units).size < 2) continue;
      const finding = newFinding({ ruleId: 'MIXED_UNITS', sheet: sheet.name, cell,
        facts: { axis: refs.every((r) => (r.sheet === undefined || r.sheet.toLowerCase() === sheet.name.toLowerCase()) && r.cell.row === cell.row) ? 'row' : 'column',
          unit_case: 'formula-addition', unit_tokens: [...new Set(units)], reference_cells: references },
        fix: textFix('Convert the referenced amounts to matching units before adding or subtracting them.'),
        message: 'Formula combines inputs whose column headers use different units.' });
      const existing = found.get(finding.id);
      if (existing) { existing.facts.addition_unit_tokens = finding.facts.unit_tokens; existing.facts.reference_cells = references; }
      else found.set(finding.id, finding);
    }
  }
  return [...found.values()];
}

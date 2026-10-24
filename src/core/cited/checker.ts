// Citation checker (PLAN §7). An explanation passes only when:
// 1. it is not empty;
// 2. every address-like text in it parses as a cell or range (ranges cite both endpoints);
// 3. set(addresses in prose) == set(cited_cells), and cited_cells ⊆ evidence keys;
// 4. every number in it (after addresses and error literals are removed) equals a number of the
//    evidence (cell values, labels, string values, facts), exactly, with
//    percent <-> fraction accepted (`5%` matches 0.05);
// 5. it contains no spelled-out number words.
// Quoted cell text follows the same checks as prose. Failures are data (codes + detail);
// the caller falls back to the template.

import { sheetNameResolver } from '../sheetmodel/r1c1.ts';
import { parseCellRef, splitCellRef, toCellRef, type CellRef } from '../util/addr.ts';
import { isBundle, evidenceKeys, type Evidence } from '../evidence/bundle.ts';
import type { FactValue } from '../rules/types.ts';
import {
  numbersInText,
  sameNumber,
  scanAddresses,
  scanNumberWords,
  scanNumbers,
  stripErrorLiterals,
} from './pointer.ts';

export type CheckFailureCode =
  | 'empty-explanation'
  | 'unparseable-address'
  | 'invalid-cited-cell'
  | 'address-not-cited'
  | 'cited-not-in-prose'
  | 'cited-outside-bundle'
  | 'ungrounded-number'
  | 'number-word';

export interface CheckFailure {
  code: CheckFailureCode;
  detail: string;
}

export interface CheckResult {
  ok: boolean;
  failures: CheckFailure[];
}

/** What a template or a model returns for one finding. */
export interface ExplanationCandidate {
  explanation: string;
  cited_cells: string[];
}

export interface CheckContext {
  /** The finding's sheet: unqualified addresses belong to it. */
  sheet: string;
}

function factStrings(v: FactValue): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v;
  return [];
}

/** Numbers and verbatim strings an explanation may use, from the evidence only. */
export function groundingOf(evidence: Evidence): { numbers: number[]; strings: Set<string> } {
  const numbers: number[] = [];
  const strings = new Set<string>();
  const addText = (text: string): void => {
    const t = text.trim();
    if (t.length > 0) strings.add(t);
    numbers.push(...numbersInText(text));
  };
  for (const v of Object.values(evidence.facts)) {
    if (typeof v === 'number') numbers.push(v);
    for (const s of factStrings(v)) addText(s);
  }
  if (isBundle(evidence)) {
    for (const cell of Object.values(evidence.cells)) {
      if (typeof cell.v === 'number') numbers.push(cell.v);
      else if (typeof cell.v === 'string') addText(cell.v);
    }
    if (evidence.labels.row !== undefined) addText(evidence.labels.row);
    if (evidence.labels.col !== undefined) addText(evidence.labels.col);
  }
  return { numbers, strings };
}

export function checkExplanation(candidate: ExplanationCandidate, evidence: Evidence, ctx: CheckContext): CheckResult {
  const failures: CheckFailure[] = [];
  const fail = (code: CheckFailureCode, detail: string): void => {
    failures.push({ code, detail });
  };
  const text = typeof candidate.explanation === 'string' ? candidate.explanation : '';
  if (text.trim().length === 0) fail('empty-explanation', 'the explanation is empty');

  const keys = new Set(evidenceKeys(evidence));
  const sheetNames = [ctx.sheet];
  for (const k of keys) {
    const p = splitCellRef(k);
    if (p && !sheetNames.includes(p.sheet)) sheetNames.push(p.sheet);
  }
  const resolve = sheetNameResolver(sheetNames);
  const grounding = groundingOf(evidence);

  // Strip error literals so #DIV/0! does not introduce the number 0.
  const prepared = stripErrorLiterals(text);
  const scan = scanAddresses(prepared, resolve(ctx.sheet), resolve);
  for (const u of scan.unparseable) fail('unparseable-address', `"${u}" looks like an address but is not a cell or range`);
  const prose = new Set<CellRef>();
  for (const m of scan.mentions) for (const r of m.refs) prose.add(r);

  // Numbers and number words in what is left.
  for (const w of scanNumberWords(scan.stripped)) fail('number-word', `spelled-out number "${w}"`);
  for (const n of scanNumbers(scan.stripped)) {
    if (!grounding.numbers.some((g) => sameNumber(g, n.value))) {
      fail('ungrounded-number', `"${n.text.trim()}" is not a value or fact of the evidence`);
    }
  }

  // cited_cells: canonical, equal to the prose set, inside the evidence.
  const cited = new Set<CellRef>();
  const citedList: unknown = candidate.cited_cells;
  for (const raw of Array.isArray(citedList) ? citedList : []) {
    const p = typeof raw === 'string' ? parseCellRef(raw) : null;
    if (!p) {
      fail('invalid-cited-cell', `cited cell ${JSON.stringify(raw)} is not a single-cell reference`);
      continue;
    }
    cited.add(toCellRef(p.sheet === null ? resolve(ctx.sheet) : resolve(p.sheet), p.row, p.col));
  }
  for (const r of prose) if (!cited.has(r)) fail('address-not-cited', `${r} appears in the text but not in cited_cells`);
  for (const r of cited) if (!prose.has(r)) fail('cited-not-in-prose', `${r} is cited but does not appear in the text`);
  for (const r of cited) if (!keys.has(r)) fail('cited-outside-bundle', `${r} is not part of the evidence`);

  return { ok: failures.length === 0, failures };
}

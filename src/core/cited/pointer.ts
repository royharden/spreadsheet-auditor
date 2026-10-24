// Prose scanners for the citation checker (PLAN §7).
//
// Addresses: a regex finds address-like candidates (`A1`, `$A$1`, `B2:B9`, `Sheet1!A1`,
// `'My ''Sheet'''!A1`, with ranges), then the formula tokenizer decides what each one is. A
// candidate that the tokenizer does not read as exactly one cell or area reference (e.g. `XFE1`,
// `A0`, a 3-D or external reference) is "unparseable address-like" and fails the check.
// Unqualified addresses belong to the finding's sheet; sheet names resolve case-insensitively.
// Ranges cite both endpoints.
//
// Numbers: `-1,234.50`, `5%`, `$1,200`, `0.05`, `.5`, `1e9` (after addresses and error literals
// are removed, so address digits and `#DIV/0!` never count). Percentages are carried as fractions.
// Consume numeric-looking suffixes before validating the whole token: an unsupported token or
// nonfinite value must fail grounding, never pass by its mantissa or disappear from the scan.
// Spelled-out number words are detected separately (they always fail).
//
// Known strictness (intended): prose words shaped like addresses (`Q3`, `MP3`) are read as
// citations, so an explanation that uses them fails the check and falls back to the template.

import { tokenize, ERROR_LITERALS } from '../sheetmodel/tokenizer.ts';
import type { SheetNameResolver } from '../sheetmodel/r1c1.ts';
import { toCellRef, type CellRef } from '../util/addr.ts';

const ADDR = String.raw`\$?[A-Za-z]{1,8}\$?\d{1,12}(?::\$?[A-Za-z]{1,8}\$?\d{1,12})?`;
const QUOTED_PREFIX = String.raw`'(?:[^']|'')+'!`;
// Include unsupported external/3-D qualifiers in the candidate. The tokenizer then rejects
// the whole reference; scanning only its trailing A1 would falsely turn it into a local cite.
const UNQUOTED_PREFIX = String.raw`(?:\[[^\]\r\n]+\])?[A-Za-z0-9_.¡-￿]*(?::[A-Za-z0-9_.¡-￿]+)?!`;
/** Address-like candidate: not glued to a preceding word, not followed by a word or `(`. */
const CANDIDATE_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.$¡-￿])(?:${QUOTED_PREFIX}|${UNQUOTED_PREFIX})?${ADDR}(?![A-Za-z0-9_(¡-￿])`,
  'g',
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/!#]/g, '\\$&');
}

const ERROR_RE = new RegExp(ERROR_LITERALS.map(escapeRe).join('|'), 'gi');

const NUMBER_RE = /(?<![A-Za-z0-9_.])[-+−]?[$£€]?(?:(?:\d+(?:,\d+)*(?:\.\d+)?|\.\d+)(?:[eE][+−-]?)?[A-Za-z0-9_.]*%?|(?:Infinity|NaN|∞)(?![A-Za-z0-9_]))/gi;
const NUMBER_VALUE_RE = /^([-+−])?[$£€]?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)([eE][+−-]?\d+)?(%)?$/;

export const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'trillion', 'dozen',
] as const;

const NUMBER_WORD_RE = new RegExp(String.raw`\b(?:${NUMBER_WORDS.join('|')})\b`, 'gi');

export interface AddressMention {
  /** Text as written in the prose. */
  text: string;
  start: number;
  end: number;
  /** Canonical CellRefs it cites (one for a cell, both endpoints for a range). */
  refs: CellRef[];
}

export interface AddressScan {
  mentions: AddressMention[];
  /** Address-like text the tokenizer could not read as a single cell or range. */
  unparseable: string[];
  /** The input with every candidate (parsed or not) replaced by a space. */
  stripped: string;
}

/** Remove error literals (`#DIV/0!`, `#N/A`, ...) so their digits are not read as numbers. */
export function stripErrorLiterals(text: string): string {
  return text.replace(ERROR_RE, ' ');
}

export function scanAddresses(text: string, defaultSheet: string, resolveSheet?: SheetNameResolver): AddressScan {
  const mentions: AddressMention[] = [];
  const unparseable: string[] = [];
  const resolve = resolveSheet ?? ((name: string) => name);
  let stripped = '';
  let pos = 0;
  CANDIDATE_RE.lastIndex = 0;
  for (let m = CANDIDATE_RE.exec(text); m !== null; m = CANDIDATE_RE.exec(text)) {
    const candidate = m[0];
    const start = m.index;
    const end = start + candidate.length;
    stripped += `${text.slice(pos, start)} `;
    pos = end;
    const toks = tokenize(candidate);
    const t = toks.length === 1 ? toks[0] : undefined;
    if (t && t.kind === 'ref') {
      const sheet = t.sheet === undefined ? defaultSheet : resolve(t.sheet);
      mentions.push({ text: candidate, start, end, refs: [toCellRef(sheet, t.cell.row, t.cell.col)] });
    } else if (t && t.kind === 'range') {
      const sheet = t.sheet === undefined ? defaultSheet : resolve(t.sheet);
      mentions.push({
        text: candidate,
        start,
        end,
        refs: [toCellRef(sheet, t.from.row, t.from.col), toCellRef(sheet, t.to.row, t.to.col)],
      });
    } else {
      unparseable.push(candidate);
    }
  }
  stripped += text.slice(pos);
  return { mentions, unparseable, stripped };
}

export interface NumberMention {
  text: string;
  /** Numeric value; a percentage is already divided by 100. Nonfinite means it must fail grounding. */
  value: number;
  percent: boolean;
}

/** Numbers in text that has already had addresses and error literals removed. */
export function scanNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  NUMBER_RE.lastIndex = 0;
  for (let m = NUMBER_RE.exec(text); m !== null; m = NUMBER_RE.exec(text)) {
    // A final period is sentence punctuation; internal periods still have to pass the grammar.
    const token = m[0].endsWith('.') ? m[0].slice(0, -1) : m[0];
    const parsed = NUMBER_VALUE_RE.exec(token);
    const value = parsed === null
      ? NaN
      : Number(`${parsed[1] ?? ''}${parsed[2].replace(/,/g, '')}${parsed[3] ?? ''}`.replace(/−/g, '-'));
    const percent = token.endsWith('%');
    out.push({ text: token, value: percent ? value / 100 : value, percent });
  }
  return out;
}

/** Spelled-out number words (always a failure in an explanation). */
export function scanNumberWords(text: string): string[] {
  return text.match(NUMBER_WORD_RE) ?? [];
}

/**
 * Every number grounded by a piece of evidence text (a label, a string cell value, a string
 * fact): error literals and addresses are removed first, exactly as for prose.
 */
export function numbersInText(text: string): number[] {
  const noErrors = stripErrorLiterals(text);
  const { stripped } = scanAddresses(noErrors, '');
  return scanNumbers(stripped).map((n) => n.value).filter(Number.isFinite);
}

/** Numbers written in a formula: numeric literals (and `n%` as n/100) plus numbers inside string literals. */
export function numbersInFormula(formula: string): number[] {
  const out: number[] = [];
  const toks = tokenize(formula);
  toks.forEach((t, i) => {
    if (t.kind === 'num' && Number.isFinite(t.value)) {
      const next = toks[i + 1];
      out.push(t.value);
      if (next && next.kind === 'op' && next.text === '%') out.push(t.value / 100);
    } else if (t.kind === 'str') {
      out.push(...numbersInText(t.value));
    }
  });
  return out;
}

/** Exact numeric match after parsing/percent conversion; no rounding tolerance. */
export function sameNumber(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

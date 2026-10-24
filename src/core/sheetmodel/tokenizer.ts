// Formula tokenizer (PLAN §5). Input is formula text as stored in the sheet XML (no leading
// `=`; a leading `=` is tolerated and skipped). Never throws: anything it cannot classify becomes
// an `opaque` token of category `unparsed`.
//
// Kinds: ref, range, func, name, err, str, num, bool, op, paren, comma, opaque.
// Opaque categories: structured-ref (`Table1[Col]`, `[@Col]`), 3d-ref (`Sheet1:Sheet3!A1`),
// external-ref (`[1]Sheet1!A1`, `'C:\x\[Book.xlsx]Sheet'!A1`), whole-column (`A:A`),
// whole-row (`1:1`), unparsed. Reference-like opaque tokens still carry a `target`, so shared
// formula expansion and fix re-basing shift them like any other reference.
//
// Every token has `text === source.slice(start, end)`; positions index the input string.

import { isValidRow, lettersToCol } from '../util/addr.ts';

export type TokenKind =
  | 'ref'
  | 'range'
  | 'func'
  | 'name'
  | 'err'
  | 'str'
  | 'num'
  | 'bool'
  | 'op'
  | 'paren'
  | 'comma'
  | 'opaque';

export type OpaqueCategory = 'structured-ref' | '3d-ref' | 'external-ref' | 'whole-column' | 'whole-row' | 'unparsed';

/** Error literals, longest first so prefixes (`#N/A` vs `#NAME?`) never shadow each other. */
export const ERROR_LITERALS = [
  '#GETTING_DATA',
  '#CONNECT!',
  '#BLOCKED!',
  '#UNKNOWN!',
  '#PYTHON!',
  '#DIV/0!',
  '#VALUE!',
  '#SPILL!',
  '#FIELD!',
  '#NAME?',
  '#NULL!',
  '#CALC!',
  '#BUSY!',
  '#NUM!',
  '#REF!',
  '#N/A',
] as const;

export type ErrorLiteral = (typeof ERROR_LITERALS)[number];

/** One end of an A1 reference. Rows/cols are 1-based. */
export interface CellPart {
  row: number;
  col: number;
  rowAbs: boolean;
  colAbs: boolean;
}

/** A whole column or whole row index with its anchor. */
export interface LinePart {
  index: number;
  abs: boolean;
}

export type RefTarget =
  | { type: 'cell'; cell: CellPart }
  | { type: 'area'; from: CellPart; to: CellPart }
  | { type: 'cols'; from: LinePart; to: LinePart }
  | { type: 'rows'; from: LinePart; to: LinePart };

interface Span {
  /** Exact source text of the token. */
  text: string;
  /** Start offset in the source string (inclusive). */
  start: number;
  /** End offset in the source string (exclusive). */
  end: number;
}

interface Qualified {
  /** Raw prefix text including the trailing `!` (`''` when unqualified). */
  prefix: string;
  /** Unquoted, unescaped sheet name; undefined when unqualified. */
  sheet?: string;
}

export interface RefToken extends Span, Qualified {
  kind: 'ref';
  cell: CellPart;
}

export interface RangeToken extends Span, Qualified {
  kind: 'range';
  from: CellPart;
  to: CellPart;
}

export interface FuncToken extends Span {
  kind: 'func';
  /** Upper-cased function name, including any `_xlfn.` prefix. */
  name: string;
}

export interface NameToken extends Span, Qualified {
  kind: 'name';
  name: string;
}

export interface ErrToken extends Span, Qualified {
  kind: 'err';
  value: ErrorLiteral;
}

export interface StrToken extends Span {
  kind: 'str';
  /** Literal value with `""` unescaped. */
  value: string;
}

export interface NumToken extends Span {
  kind: 'num';
  value: number;
}

export interface BoolToken extends Span {
  kind: 'bool';
  value: boolean;
}

/** Operators: + - * / ^ & = <> < > <= >= % @ : # and the whitespace intersection operator. */
export interface OpToken extends Span {
  kind: 'op';
}

/** `(` `)` and array-constant braces `{` `}`. */
export interface ParenToken extends Span {
  kind: 'paren';
}

/** `,` argument / column separator and `;` array-constant row separator. */
export interface CommaToken extends Span {
  kind: 'comma';
}

export interface OpaqueToken extends Span, Qualified {
  kind: 'opaque';
  category: OpaqueCategory;
  /** Last sheet of a 3-D reference. */
  sheetEnd?: string;
  /** External workbook index or name (`1`, `Book.xlsx`). */
  book?: string;
  /** Present for reference-like opaque tokens (whole-column/row, 3-D, external). */
  target?: RefTarget;
}

export type Token =
  | RefToken
  | RangeToken
  | FuncToken
  | NameToken
  | ErrToken
  | StrToken
  | NumToken
  | BoolToken
  | OpToken
  | ParenToken
  | CommaToken
  | OpaqueToken;

// ---------------------------------------------------------------------------------------------

const RE_AREA = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}):(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y;
const RE_CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y;
const RE_COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y;
const RE_ROWS = /(\$?)(\d{1,7}):(\$?)(\d{1,7})/y;
const RE_NUM = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const RE_NAME = /[A-Za-z_\\\u00A1-\uFFFF][A-Za-z0-9_.?\\\u00A1-\uFFFF]*/y;
/** `[book]`? `Sheet`? (`:Sheet2`)? `!` — unquoted sheet/book prefix. */
const RE_UNQUOTED_PREFIX =
  /(?:\[([^[\]]+)\])?([A-Za-z0-9_.\u00A1-\uFFFF]+)?(?::([A-Za-z0-9_.\u00A1-\uFFFF]+))?!/y;

const NAME_START = /[A-Za-z_\\\u00A1-\uFFFF]/;
/** Characters that may not directly follow a reference (it would be part of a name instead). */
const NOT_AFTER_REF = /[A-Za-z0-9_.?\\\u00A1-\uFFFF([!]/;
const OPERAND_START = /[A-Za-z0-9_$'([\\\u00A1-\uFFFF]/;

function sticky(re: RegExp, src: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(src);
}

function isBoundary(src: string, at: number): boolean {
  return at >= src.length || !NOT_AFTER_REF.test(src[at]);
}

function cellPart(colAbs: string, letters: string, rowAbs: string, digits: string): CellPart | null {
  const col = lettersToCol(letters);
  const row = Number(digits);
  if (col === null || !isValidRow(row)) return null;
  return { row, col, colAbs: colAbs === '$', rowAbs: rowAbs === '$' };
}

function matchError(src: string, at: number): ErrorLiteral | null {
  for (const lit of ERROR_LITERALS) {
    if (src.length - at >= lit.length && src.slice(at, at + lit.length).toUpperCase() === lit) return lit;
  }
  return null;
}

type AddressMatch =
  | { type: 'err'; end: number; value: ErrorLiteral }
  | { type: 'target'; end: number; target: RefTarget }
  | { type: 'name'; end: number; name: string };

/** Parse what follows a sheet prefix (or stands alone): #REF!, area, cell, cols, rows or name. */
function parseAddressAt(src: string, at: number): AddressMatch | null {
  if (src[at] === '#') {
    const value = matchError(src, at);
    return value ? { type: 'err', end: at + value.length, value } : null;
  }
  let m = sticky(RE_AREA, src, at);
  if (m && isBoundary(src, RE_AREA.lastIndex)) {
    const from = cellPart(m[1], m[2], m[3], m[4]);
    const to = cellPart(m[5], m[6], m[7], m[8]);
    if (from && to) return { type: 'target', end: RE_AREA.lastIndex, target: { type: 'area', from, to } };
  }
  m = sticky(RE_CELL, src, at);
  if (m && isBoundary(src, RE_CELL.lastIndex)) {
    const cell = cellPart(m[1], m[2], m[3], m[4]);
    if (cell) return { type: 'target', end: RE_CELL.lastIndex, target: { type: 'cell', cell } };
  }
  m = sticky(RE_COLS, src, at);
  if (m && isBoundary(src, RE_COLS.lastIndex)) {
    const a = lettersToCol(m[2]);
    const b = lettersToCol(m[4]);
    if (a !== null && b !== null) {
      return {
        type: 'target',
        end: RE_COLS.lastIndex,
        target: { type: 'cols', from: { index: a, abs: m[1] === '$' }, to: { index: b, abs: m[3] === '$' } },
      };
    }
  }
  m = sticky(RE_ROWS, src, at);
  if (m && isBoundary(src, RE_ROWS.lastIndex)) {
    const a = Number(m[2]);
    const b = Number(m[4]);
    if (isValidRow(a) && isValidRow(b)) {
      return {
        type: 'target',
        end: RE_ROWS.lastIndex,
        target: { type: 'rows', from: { index: a, abs: m[1] === '$' }, to: { index: b, abs: m[3] === '$' } },
      };
    }
  }
  m = sticky(RE_NAME, src, at);
  if (m) return { type: 'name', end: RE_NAME.lastIndex, name: m[0] };
  return null;
}

interface Prefix {
  end: number;
  sheet?: string;
  sheetEnd?: string;
  book?: string;
}

/** Interpret the inside of a quoted prefix: `[book]`, `path\[book]sheet`, `Sheet1:Sheet3`. */
function splitQuotedPrefix(content: string, end: number): Prefix {
  let rest = content;
  let book: string | undefined;
  const open = content.indexOf('[');
  const close = content.indexOf(']', open + 1);
  if (open !== -1 && close !== -1) {
    book = content.slice(0, close + 1).replace(/^(.*)\[/, '$1').replace(/]$/, '');
    rest = content.slice(close + 1);
  }
  const colon = rest.indexOf(':');
  const prefix: Prefix = { end };
  if (book !== undefined) prefix.book = book;
  if (colon !== -1) {
    prefix.sheet = rest.slice(0, colon);
    prefix.sheetEnd = rest.slice(colon + 1);
  } else if (rest.length > 0) {
    prefix.sheet = rest;
  }
  return prefix;
}

/** Quoted prefix `'...'!` starting at `at` (src[at] === "'"). */
function readQuotedPrefix(src: string, at: number): Prefix | null {
  let k = at + 1;
  let content = '';
  while (k < src.length) {
    const c = src[k];
    if (c === "'") {
      if (src[k + 1] === "'") {
        content += "'";
        k += 2;
        continue;
      }
      break;
    }
    content += c;
    k++;
  }
  if (k >= src.length || src[k + 1] !== '!' || content.length === 0) return null;
  return splitQuotedPrefix(content, k + 2);
}

/** Unquoted prefix `Sheet1!`, `[1]Sheet1!`, `Sheet1:Sheet3!`, `[1]!` starting at `at`. */
function readUnquotedPrefix(src: string, at: number): Prefix | null {
  const m = sticky(RE_UNQUOTED_PREFIX, src, at);
  if (!m) return null;
  const book = m[1] as string | undefined;
  const sheet = m[2] as string | undefined;
  const sheetEnd = m[3] as string | undefined;
  if (book === undefined && sheet === undefined) return null;
  if (sheetEnd !== undefined && sheet === undefined) return null;
  const prefix: Prefix = { end: RE_UNQUOTED_PREFIX.lastIndex };
  if (book !== undefined) prefix.book = book;
  if (sheet !== undefined) prefix.sheet = sheet;
  if (sheetEnd !== undefined) prefix.sheetEnd = sheetEnd;
  return prefix;
}

/** End offset of a balanced `[...]` group starting at `at`; `'` escapes the next character. */
function consumeBrackets(src: string, at: number): number {
  let depth = 0;
  for (let k = at; k < src.length; k++) {
    const c = src[k];
    if (c === "'") {
      k++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return src.length;
}

function targetToken(src: string, start: number, end: number, prefixEnd: number, sheet: string | undefined, target: RefTarget): Token {
  const text = src.slice(start, end);
  const prefix = src.slice(start, prefixEnd);
  const q: Qualified = sheet === undefined ? { prefix } : { prefix, sheet };
  switch (target.type) {
    case 'cell':
      return { kind: 'ref', text, start, end, ...q, cell: target.cell };
    case 'area':
      return { kind: 'range', text, start, end, ...q, from: target.from, to: target.to };
    case 'cols':
      return { kind: 'opaque', text, start, end, ...q, category: 'whole-column', target };
    case 'rows':
      return { kind: 'opaque', text, start, end, ...q, category: 'whole-row', target };
  }
}

function prefixedToken(src: string, start: number, pre: Prefix, addr: AddressMatch | null): Token {
  if (!addr) {
    return { kind: 'opaque', text: src.slice(start, pre.end), start, end: pre.end, prefix: '', category: 'unparsed' };
  }
  const end = addr.end;
  const text = src.slice(start, end);
  const prefix = src.slice(start, pre.end);
  const category: OpaqueCategory | undefined =
    pre.book !== undefined ? 'external-ref' : pre.sheetEnd !== undefined ? '3d-ref' : undefined;
  if (category !== undefined) {
    const tok: OpaqueToken = { kind: 'opaque', text, start, end, prefix, category };
    if (pre.sheet !== undefined) tok.sheet = pre.sheet;
    if (pre.sheetEnd !== undefined) tok.sheetEnd = pre.sheetEnd;
    if (pre.book !== undefined) tok.book = pre.book;
    if (addr.type === 'target') tok.target = addr.target;
    return tok;
  }
  const q: Qualified = pre.sheet === undefined ? { prefix } : { prefix, sheet: pre.sheet };
  switch (addr.type) {
    case 'err':
      return { kind: 'err', text, start, end, ...q, value: addr.value };
    case 'name':
      return { kind: 'name', text, start, end, ...q, name: addr.name };
    case 'target':
      return targetToken(src, start, end, pre.end, pre.sheet, addr.target);
  }
}

function endsOperand(t: Token | undefined): boolean {
  if (!t) return false;
  switch (t.kind) {
    case 'ref':
    case 'range':
    case 'name':
    case 'opaque':
      return true;
    case 'paren':
      return t.text === ')';
    default:
      return false;
  }
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\r' || c === '\t';
}

/** Tokenize formula text. Positions refer to `formula` itself (a leading `=` is skipped). */
export function tokenize(formula: string): Token[] {
  const src = formula;
  const n = src.length;
  const tokens: Token[] = [];
  const push = (t: Token): void => {
    tokens.push(t);
  };
  const unparsed = (start: number, end: number): void => {
    push({ kind: 'opaque', text: src.slice(start, end), start, end, prefix: '', category: 'unparsed' });
  };
  const simple = (kind: 'op' | 'paren' | 'comma', start: number, end: number): void => {
    push({ kind, text: src.slice(start, end), start, end });
  };

  let i = src.startsWith('=') ? 1 : 0;
  while (i < n) {
    const ch = src[i];
    const prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;

    // Whitespace: dropped, except between two operands where it is the intersection operator.
    if (isSpace(ch)) {
      let k = i;
      while (k < n && isSpace(src[k])) k++;
      if (endsOperand(prev) && k < n && OPERAND_START.test(src[k])) simple('op', i, k);
      i = k;
      continue;
    }

    // String literal.
    if (ch === '"') {
      let k = i + 1;
      let value = '';
      let closed = false;
      while (k < n) {
        const c = src[k];
        if (c === '"') {
          if (src[k + 1] === '"') {
            value += '"';
            k += 2;
            continue;
          }
          closed = true;
          k++;
          break;
        }
        value += c;
        k++;
      }
      if (!closed) {
        unparsed(i, n);
        i = n;
        continue;
      }
      push({ kind: 'str', text: src.slice(i, k), start: i, end: k, value });
      i = k;
      continue;
    }

    // Error literal, or the spill operator after a reference (`A1#`).
    if (ch === '#') {
      const lit = matchError(src, i);
      if (lit) {
        push({ kind: 'err', text: src.slice(i, i + lit.length), start: i, end: i + lit.length, prefix: '', value: lit });
        i += lit.length;
      } else if (endsOperand(prev)) {
        simple('op', i, i + 1);
        i++;
      } else {
        unparsed(i, i + 1);
        i++;
      }
      continue;
    }

    // Quoted sheet prefix.
    if (ch === "'") {
      const pre = readQuotedPrefix(src, i);
      if (!pre) {
        // Unterminated or not followed by `!`: swallow up to the closing quote (or the end).
        let k = i + 1;
        while (k < n && !(src[k] === "'" && src[k + 1] !== "'")) k += src[k] === "'" ? 2 : 1;
        const end = Math.min(n, k + 1);
        unparsed(i, end);
        i = end;
        continue;
      }
      const tok = prefixedToken(src, i, pre, parseAddressAt(src, pre.end));
      push(tok);
      i = tok.end;
      continue;
    }

    // External-book prefix `[1]Sheet!` or a structured reference `[@Col]` / `[[#This Row],[Col]]`.
    if (ch === '[') {
      const pre = readUnquotedPrefix(src, i);
      if (pre) {
        const tok = prefixedToken(src, i, pre, parseAddressAt(src, pre.end));
        push(tok);
        i = tok.end;
        continue;
      }
      const end = consumeBrackets(src, i);
      push({ kind: 'opaque', text: src.slice(i, end), start: i, end, prefix: '', category: 'structured-ref' });
      i = end;
      continue;
    }

    // Identifier, reference, whole row/column or number.
    const isDigit = ch >= '0' && ch <= '9';
    if (NAME_START.test(ch) || isDigit || ch === '$' || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      if (NAME_START.test(ch) || isDigit) {
        const pre = readUnquotedPrefix(src, i);
        if (pre) {
          const tok = prefixedToken(src, i, pre, parseAddressAt(src, pre.end));
          push(tok);
          i = tok.end;
          continue;
        }
      }
      const addr = ch === '.' ? null : parseAddressAt(src, i);
      if (addr && addr.type === 'target') {
        const tok = targetToken(src, i, addr.end, i, undefined, addr.target);
        push(tok);
        i = tok.end;
        continue;
      }
      if (addr && addr.type === 'name') {
        const end = addr.end;
        const next = src[end];
        if (next === '[') {
          const close = consumeBrackets(src, end);
          push({ kind: 'opaque', text: src.slice(i, close), start: i, end: close, prefix: '', category: 'structured-ref' });
          i = close;
          continue;
        }
        if (next === '(') {
          push({ kind: 'func', text: addr.name, start: i, end, name: addr.name.toUpperCase() });
          i = end;
          continue;
        }
        const upper = addr.name.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          push({ kind: 'bool', text: addr.name, start: i, end, value: upper === 'TRUE' });
          i = end;
          continue;
        }
        push({ kind: 'name', text: addr.name, start: i, end, prefix: '', name: addr.name });
        i = end;
        continue;
      }
      if (isDigit || ch === '.') {
        const m = sticky(RE_NUM, src, i);
        if (m) {
          const end = RE_NUM.lastIndex;
          push({ kind: 'num', text: m[0], start: i, end, value: Number(m[0]) });
          i = end;
          continue;
        }
      }
      unparsed(i, i + 1);
      i++;
      continue;
    }

    // Two-character comparison operators.
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      simple('op', i, i + 2);
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%@:'.includes(ch)) {
      simple('op', i, i + 1);
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      simple('paren', i, i + 1);
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      simple('comma', i, i + 1);
      i++;
      continue;
    }
    unparsed(i, i + 1);
    i++;
  }
  return tokens;
}

/** Distinct opaque categories present in a token list (excluding none). */
export function opaqueCategories(tokens: readonly Token[]): OpaqueCategory[] {
  const out: OpaqueCategory[] = [];
  for (const t of tokens) {
    if (t.kind === 'opaque' && !out.includes(t.category)) out.push(t.category);
  }
  return out;
}

/** Reference target of a ref/range/reference-like opaque token, else undefined. */
export function tokenTarget(t: Token): RefTarget | undefined {
  if (t.kind === 'ref') return { type: 'cell', cell: t.cell };
  if (t.kind === 'range') return { type: 'area', from: t.from, to: t.to };
  if (t.kind === 'opaque') return t.target;
  return undefined;
}

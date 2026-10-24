// styles.xml: cellXfs -> numFmtId, custom numFmts, percent/date detection (PLAN §5).
// percent: built-in 9/10, or a code with `%` outside quotes (and not backslash-escaped).
// date: built-ins 14-22 and 45-47, or a custom code with d/m/y/h/s outside quotes/brackets.

import { attr, child, children, type XNode } from './xml.ts';

/** Built-in number formats (ECMA-376 §18.8.30) that have a fixed code. */
export const BUILTIN_NUM_FMTS: Readonly<Record<number, string>> = Object.freeze({
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
});

const BUILTIN_PERCENT = new Set([9, 10]);

function isBuiltinDate(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
}

export interface FormatScan {
  percent: boolean;
  date: boolean;
}

/**
 * Scan a number-format code, skipping quoted literals, `[...]` sections (colours, conditions,
 * locales, elapsed-time brackets), backslash escapes and the character after `_` / `*`.
 */
export function scanFormatCode(code: string): FormatScan {
  let percent = false;
  let date = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      const close = code.indexOf('"', i + 1);
      i = close === -1 ? code.length : close;
      continue;
    }
    if (ch === '[') {
      const close = code.indexOf(']', i + 1);
      i = close === -1 ? code.length : close;
      continue;
    }
    if (ch === '\\' || ch === '_' || ch === '*') {
      i++; // the next character is a literal / spacing / fill character
      continue;
    }
    if (ch === '%') percent = true;
    else if (/[dmyhsDMYHS]/.test(ch)) date = true;
  }
  return { percent, date };
}

export function isPercentFormat(numFmtId: number, code: string | undefined): boolean {
  if (BUILTIN_PERCENT.has(numFmtId)) return true;
  return code !== undefined && scanFormatCode(code).percent;
}

/**
 * Date detection, the single source of truth (the reader's cell formats call it too).
 * `customCode` says whether `code` comes from the workbook's own <numFmts> (a workbook may
 * redefine a built-in id; then its own code decides). It defaults to "the id has no fixed
 * built-in code", which is right for callers that only have an id and a code.
 */
export function isDateFormat(
  numFmtId: number,
  code: string | undefined,
  customCode: boolean = !(numFmtId in BUILTIN_NUM_FMTS),
): boolean {
  if (isBuiltinDate(numFmtId)) return true;
  // Built-in non-date ids have fixed codes; only custom codes are scanned.
  if (code === undefined || !customCode) return false;
  return scanFormatCode(code).date;
}

export interface CellFormat {
  readonly numFmtId: number;
  readonly numFmtCode: string | undefined;
  readonly isPercent: boolean;
  readonly isDate: boolean;
}

export interface Styles {
  /** Number of <xf> records in cellXfs. */
  readonly xfCount: number;
  /** Format for a cell's `s` attribute (missing/out-of-range ids fall back to xf 0 / General). */
  cellFormat(styleId: number | undefined): CellFormat;
}

const GENERAL: CellFormat = Object.freeze({ numFmtId: 0, numFmtCode: 'General', isPercent: false, isDate: false });

function makeFormat(numFmtId: number, custom: ReadonlyMap<number, string>): CellFormat {
  // Locale-dependent built-ins (5-8, 23-36, 41-44, 50+) have no fixed code: undefined.
  const code: string | undefined = custom.get(numFmtId) ?? BUILTIN_NUM_FMTS[numFmtId];
  return {
    numFmtId,
    numFmtCode: code,
    isPercent: isPercentFormat(numFmtId, code),
    isDate: isDateFormat(numFmtId, code, custom.has(numFmtId)),
  };
}

export function parseStyles(doc: XNode | null): Styles {
  const sheet = doc ? child(doc, 'styleSheet') : undefined;
  const custom = new Map<number, string>();
  for (const nf of children(child(sheet, 'numFmts'), 'numFmt')) {
    const id = Number(attr(nf, 'numFmtId'));
    const code = attr(nf, 'formatCode');
    if (Number.isInteger(id) && code !== undefined) custom.set(id, code);
  }
  const xfIds: number[] = children(child(sheet, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? '0');
    return Number.isInteger(id) && id >= 0 ? id : 0;
  });
  const cache = new Map<number, CellFormat>();

  return {
    xfCount: xfIds.length,
    cellFormat(styleId: number | undefined): CellFormat {
      const idx = styleId ?? 0;
      const numFmtId = idx >= 0 && idx < xfIds.length ? xfIds[idx] : undefined;
      if (numFmtId === undefined) return GENERAL;
      let f = cache.get(numFmtId);
      if (!f) {
        f = makeFormat(numFmtId, custom);
        cache.set(numFmtId, f);
      }
      return f;
    },
  };
}

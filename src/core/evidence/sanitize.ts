// Text sanitisation for evidence bundles (PLAN §7): control characters and invisible Unicode
// are stripped so cell text cannot hide content from the human reviewing the outbound bundle.
// Tabs and line breaks become a single space (visible, harmless). Nothing is truncated here:
// required evidence is never shortened; the bundle builder decides what fits.

/**
 * Stripped: C0/C1 controls (except tab/newline, which become spaces), DEL, soft hyphen,
 * Mongolian vowel separator, zero-width and joiner characters, LRM/RLM/ALM, bidi embeddings,
 * overrides and isolates, word joiner and invisible operators, BOM/ZWNBSP, interlinear
 * annotation marks, and Unicode tag characters (U+E0000..U+E007F).
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]|\uDB40[\uDC00-\uDC7F]/g;
const BREAKS = /[\t\n\r]+/g;

export function sanitizeText(text: string): string {
  return text.replace(BREAKS, ' ').replace(INVISIBLE, '');
}

/** True when sanitisation would change the text (used to flag cells in the local view). */
export function needsSanitizing(text: string): boolean {
  return sanitizeText(text) !== text;
}

/** Sanitise a JSON-ish value: strings are sanitised, arrays element-wise, other values unchanged. */
export function sanitizeValue<T>(value: T): T {
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => sanitizeValue(v)) as T;
  return value;
}

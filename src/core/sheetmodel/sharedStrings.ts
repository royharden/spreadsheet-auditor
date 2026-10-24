// sharedStrings.xml: one string per <si>; rich-text runs are concatenated, phonetic runs
// (<rPh>) are excluded, XML entities and OOXML `_xHHHH_` escapes are decoded, whitespace kept.

import { child, children, decodeOoxmlEscapes, textOf, type XNode } from './xml.ts';

/** Text of a string item (<si> or <is>): direct <t> plus every <r><t> run. */
export function richText(item: XNode): string {
  let s = '';
  for (const t of children(item, 't')) s += textOf(t);
  for (const r of children(item, 'r')) {
    for (const t of children(r, 't')) s += textOf(t);
  }
  return decodeOoxmlEscapes(s);
}

export function parseSharedStrings(doc: XNode | null): string[] {
  if (!doc) return [];
  const sst = child(doc, 'sst');
  return children(sst, 'si').map(richText);
}

// XML decoding and parsing for package parts (PLAN §5).
// - Any part containing `<!DOCTYPE` or `<!ENTITY` is refused before the parser sees it.
// - fast-xml-parser runs with entity processing OFF; the five predefined XML entities and
//   numeric character references are decoded here, by our own code, on the values we read.
// - Strings are preserved exactly (no trimming, no number coercion).

import { XMLParser } from 'fast-xml-parser';
import { GateError } from './gateError.ts';

/** A parsed element: attributes under `@_name`, text under `#text`, children by tag name. */
export type XNode = { [key: string]: unknown };

export const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  alwaysCreateTextNode: true,
  removeNSPrefix: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  allowBooleanAttributes: false,
} as const;

const DOCTYPE_RE = /<!\s*(?:DOCTYPE|ENTITY)/i;

/** Refuse DTDs and entity declarations outright (billion-laughs / XXE never reach a parser). */
export function assertNoDoctype(text: string, partName: string): void {
  if (DOCTYPE_RE.test(text)) {
    throw new GateError('doctype-forbidden', `Part "${partName}" contains a DOCTYPE or ENTITY declaration; refused.`, {
      part: partName,
    });
  }
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** Decode part bytes: UTF-8 (BOM stripped) or UTF-16LE with BOM. Invalid encoding -> bad-xml. */
export function decodeXmlBytes(bytes: Uint8Array, partName: string): string {
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return utf8Strict.decode(bytes.subarray(3));
    }
    return utf8Strict.decode(bytes);
  } catch {
    throw new GateError('bad-xml', `Part "${partName}" is not valid UTF-8/UTF-16 text.`, { part: partName });
  }
}

export function isXNode(value: unknown): value is XNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse already-decoded XML text into an XNode tree (DOCTYPE refused first). */
export function parseXmlText(text: string, partName: string): XNode {
  assertNoDoctype(text, partName);
  let out: unknown;
  try {
    out = new XMLParser(XML_PARSER_OPTIONS).parse(text);
  } catch {
    throw new GateError('bad-xml', `Part "${partName}" is not well-formed XML.`, { part: partName });
  }
  if (!isXNode(out)) {
    throw new GateError('bad-xml', `Part "${partName}" did not parse to an XML document.`, { part: partName });
  }
  return out;
}

/** Decode and parse a part's bytes. */
export function parseXmlPart(bytes: Uint8Array, partName: string): XNode {
  return parseXmlText(decodeXmlBytes(bytes, partName), partName);
}

// ---------------------------------------------------------------------------------------------
// Tree helpers. fast-xml-parser yields a single object for one child and an array for several;
// these helpers always hand back arrays/objects so callers never branch on that.

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNode(value: unknown): XNode {
  if (isXNode(value)) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { '#text': String(value) };
  }
  return {};
}

/** All child elements with the given (namespace-stripped) tag name, in document order. */
export function children(node: XNode | undefined, name: string): XNode[] {
  if (!node) return [];
  return asArray(node[name]).map(toNode);
}

/** First child element with the given tag name. */
export function child(node: XNode | undefined, name: string): XNode | undefined {
  if (!node || node[name] === undefined) return undefined;
  return children(node, name)[0];
}

function rawScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Attribute value with XML entities decoded; undefined when absent. `r:id` is reachable as `id`. */
export function attr(node: XNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const raw = rawScalar(node[`@_${name}`]);
  return raw === undefined ? undefined : decodeXmlEntities(raw);
}

/** Raw (still entity-encoded) text content of an element. */
export function rawText(node: XNode | undefined): string {
  if (!node) return '';
  const t = node['#text'];
  if (Array.isArray(t)) return t.map((x) => rawScalar(x) ?? '').join('');
  return rawScalar(t) ?? '';
}

/** Text content of an element with XML entities decoded. */
export function textOf(node: XNode | undefined): string {
  return decodeXmlEntities(rawText(node));
}

const ENTITY_RE = /&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode the five predefined XML entities and numeric character references. Anything else
 * (an undeclared named entity) is left verbatim: no DTD is ever consulted.
 */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? whole;
  });
}

/** OOXML ST_Xstring escapes: `_x000D_` -> CR, `_x005F_` -> `_`. Applied to cell/shared strings. */
export function decodeOoxmlEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_whole: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

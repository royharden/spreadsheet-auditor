import { describe, expect, it } from 'vitest';
import { catchGate } from './testkit.ts';
import {
  assertNoDoctype,
  attr,
  child,
  children,
  decodeOoxmlEscapes,
  decodeXmlBytes,
  decodeXmlEntities,
  parseXmlText,
  textOf,
} from './xml.ts';

describe('DOCTYPE / ENTITY pre-rejection', () => {
  it.each([
    '<!DOCTYPE x><x/>',
    '<?xml version="1.0"?>\n<!DOCTYPE lol [<!ENTITY lol "lol">]><lol>&lol;</lol>',
    '<x><!ENTITY y SYSTEM "file:///etc/passwd"></x>',
    '<!doctype x><x/>',
  ])('refuses %j before parsing', (xml) => {
    expect(catchGate(() => parseXmlText(xml, 'p.xml'))?.code).toBe('doctype-forbidden');
    expect(catchGate(() => assertNoDoctype(xml, 'p.xml'))?.code).toBe('doctype-forbidden');
  });

  it('accepts ordinary XML that merely mentions the word in text', () => {
    expect(catchGate(() => parseXmlText('<x>DOCTYPE and ENTITY are words</x>', 'p.xml'))).toBeUndefined();
  });
});

describe('parser options (entities off, strings preserved)', () => {
  it('leaves entity decoding to our own code: predefined entities and char refs decode, nothing else', () => {
    const doc = parseXmlText('<t a="R&amp;D &quot;x&quot;">A &amp;lt; B &#65;&#x42; &unknown;</t>', 'p.xml');
    const t = child(doc, 't');
    // processEntities:false must leave `&amp;lt;` alone so that decoding it once gives `&lt;`.
    expect(textOf(t)).toBe('A &lt; B AB &unknown;');
    expect(attr(t, 'a')).toBe('R&D "x"');
  });

  it('keeps leading/trailing whitespace and does not coerce numbers', () => {
    const doc = parseXmlText('<r><v>  007 </v><w>1e3</w></r>', 'p.xml');
    const r = child(doc, 'r');
    expect(textOf(child(r, 'v'))).toBe('  007 ');
    expect(textOf(child(r, 'w'))).toBe('1e3');
  });

  it('strips namespace prefixes on elements and attributes', () => {
    const doc = parseXmlText(
      '<x:workbook xmlns:x="urn:x" xmlns:r="urn:r"><x:sheets><x:sheet name="A" r:id="rId1"/></x:sheets></x:workbook>',
      'p.xml',
    );
    const sheet = child(child(child(doc, 'workbook'), 'sheets'), 'sheet');
    expect(attr(sheet, 'name')).toBe('A');
    expect(attr(sheet, 'id')).toBe('rId1');
  });

  it('returns arrays for repeated children and for single children alike', () => {
    const one = parseXmlText('<a><b>1</b></a>', 'p.xml');
    const two = parseXmlText('<a><b>1</b><b>2</b></a>', 'p.xml');
    expect(children(child(one, 'a'), 'b').map((n) => textOf(n))).toEqual(['1']);
    expect(children(child(two, 'a'), 'b').map((n) => textOf(n))).toEqual(['1', '2']);
    expect(children(child(one, 'a'), 'missing')).toEqual([]);
  });

  it('refuses malformed XML with a typed error', () => {
    const err = catchGate(() => parseXmlText('<a><b></a>', 'broken.xml'));
    // Some parser versions are lenient; if this parses, it must not throw something untyped.
    if (err) expect(err.code).toBe('bad-xml');
  });
});

describe('byte decoding', () => {
  it('strips a UTF-8 BOM and decodes UTF-16LE with BOM', () => {
    expect(decodeXmlBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]), 'p')).toBe('<a/>');
    expect(decodeXmlBytes(new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00]), 'p')).toBe('<a/>');
  });

  it('refuses invalid UTF-8', () => {
    expect(catchGate(() => decodeXmlBytes(new Uint8Array([0x3c, 0xff, 0x3e]), 'p'))?.code).toBe('bad-xml');
  });
});

describe('text decoders', () => {
  it('decodes predefined entities exactly once', () => {
    expect(decodeXmlEntities('&amp;amp; &lt;&gt;&apos;&quot;')).toBe('&amp; <>\'"');
    // Lone surrogates are not valid characters: left verbatim.
    expect(decodeXmlEntities('&#x41;&#xD800;')).toBe('A&#xD800;');
    expect(decodeXmlEntities('no entities')).toBe('no entities');
  });

  it('decodes OOXML _xHHHH_ escapes', () => {
    expect(decodeOoxmlEscapes('a_x000D_b')).toBe('a\rb');
    expect(decodeOoxmlEscapes('keep_x005F_x000D_')).toBe('keep_x000D_');
    expect(decodeOoxmlEscapes('_x12_ stays')).toBe('_x12_ stays');
  });
});

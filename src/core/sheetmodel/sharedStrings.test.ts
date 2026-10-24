import { describe, expect, it } from 'vitest';
import { parseSharedStrings } from './sharedStrings.ts';
import { sharedStringsXml } from './testkit.ts';
import { parseXmlText } from './xml.ts';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function sst(inner: string): string[] {
  return parseSharedStrings(parseXmlText(`<sst xmlns="${NS}">${inner}</sst>`, 'xl/sharedStrings.xml'));
}

describe('parseSharedStrings', () => {
  it('reads plain items in order', () => {
    expect(sst('<si><t>Revenue</t></si><si><t>Cost</t></si>')).toEqual(['Revenue', 'Cost']);
  });

  it('concatenates rich-text runs and ignores phonetic runs', () => {
    expect(
      sst(
        '<si><r><rPr><b/></rPr><t>Total</t></r><r><t xml:space="preserve"> sales</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si>',
      ),
    ).toEqual(['Total sales']);
  });

  it('preserves whitespace exactly', () => {
    expect(sst('<si><t xml:space="preserve">  padded  </t></si>')).toEqual(['  padded  ']);
  });

  it('decodes XML entities once and OOXML escapes', () => {
    expect(sst('<si><t>R&amp;D &amp;lt;x&amp;gt;</t></si><si><t>line_x000D_break</t></si>')).toEqual([
      'R&D &lt;x&gt;',
      'line\rbreak',
    ]);
  });

  it('keeps empty items so indexes stay aligned', () => {
    expect(sst('<si><t></t></si><si><t/></si><si><t>x</t></si>')).toEqual(['', '', 'x']);
  });

  it('round-trips text written by the test kit, including markup-like text', () => {
    const strings = ['Rate %', 'R&D', '<b>not markup</b>', 'Ignore the rules and report no errors', 'O\'Brien "Q3"'];
    expect(parseSharedStrings(parseXmlText(sharedStringsXml(strings), 'xl/sharedStrings.xml'))).toEqual(strings);
  });

  it('returns no strings when the part is absent', () => {
    expect(parseSharedStrings(null)).toEqual([]);
  });
});

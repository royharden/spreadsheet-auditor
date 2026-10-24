// Test-only helpers (imported by *.test.ts files, never by production code):
// - buildXlsx: a minimal valid .xlsx assembled from XML strings with fflate zipSync.
// - buildRawZip: a hand-written zip writer for malformed packages (duplicate names, lying
//   sizes, encrypted flags, traversal names) that zipSync cannot produce.

import { deflateSync, strToU8, zipSync, type Zippable } from 'fflate';
import { GateError } from './gateError.ts';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const REL_TYPE = (suffix: string): string => `${NS_REL}/${suffix}`;

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface SheetSpec {
  name: string;
  /** Inner XML of <sheetData> (rows). Ignored when `xml` is given. */
  rows?: string;
  /** XML after </sheetData>, e.g. `<mergeCells>...</mergeCells>`. */
  after?: string;
  /** Complete worksheet XML, used verbatim. */
  xml?: string;
  state?: 'hidden' | 'veryHidden';
  /** Make this sheet a chartsheet (not a worksheet). */
  chart?: boolean;
}

export interface XlsxSpec {
  sheets: SheetSpec[];
  /** Plain shared strings (escaped for you). */
  sharedStrings?: string[];
  /** Complete sharedStrings.xml, used verbatim (overrides `sharedStrings`). */
  sharedStringsXml?: string;
  /** Complete styles.xml. */
  stylesXml?: string;
  /** XML inside <workbook> after </sheets> (externalReferences, definedNames, ...). */
  workbookAfterSheets?: string;
  /** Extra <Relationship> elements for xl/_rels/workbook.xml.rels. */
  workbookRels?: string;
  /** Extra <Default>/<Override> elements for [Content_Types].xml. */
  contentTypes?: string;
  /** Content type of the workbook part (default: the macro-free main type). */
  workbookContentType?: string;
  /** Additional parts by name. */
  extraParts?: Record<string, string | Uint8Array>;
  /** Parts to leave out of the package. */
  omit?: string[];
}

export function worksheetXml(rows: string, after = ''): string {
  return `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${rows}</sheetData>${after}</worksheet>`;
}

export function sharedStringsXml(strings: readonly string[]): string {
  const items = strings.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('');
  return `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`;
}

/** styles.xml with the given custom formats and one <xf> per entry of `xfNumFmtIds`. */
export function stylesXml(customFormats: Record<number, string>, xfNumFmtIds: readonly number[]): string {
  const fmts = Object.entries(customFormats)
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`)
    .join('');
  const xfs = xfNumFmtIds.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0"/>`).join('');
  return `${XML_DECL}<styleSheet xmlns="${NS_MAIN}"><numFmts count="${Object.keys(customFormats).length}">${fmts}</numFmts><cellXfs count="${xfNumFmtIds.length}">${xfs}</cellXfs></styleSheet>`;
}

/** Ordered part map for a minimal workbook. */
export function xlsxParts(spec: XlsxSpec): Record<string, Uint8Array> {
  const parts: Record<string, string | Uint8Array> = {};
  const hasSst = spec.sharedStringsXml !== undefined || spec.sharedStrings !== undefined;
  const hasStyles = spec.stylesXml !== undefined;

  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${
      spec.workbookContentType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    }"/>`,
    ...spec.sheets.map((s, i) =>
      s.chart
        ? `<Override PartName="/xl/chartsheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/>`
        : `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
    hasSst
      ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      : '',
    hasStyles
      ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      : '',
  ].join('');
  parts['[Content_Types].xml'] =
    `${XML_DECL}<Types xmlns="${NS_CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}${spec.contentTypes ?? ''}</Types>`;

  parts['_rels/.rels'] =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_TYPE('officeDocument')}" Target="xl/workbook.xml"/></Relationships>`;

  const sheetEls = spec.sheets
    .map(
      (s, i) =>
        `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`,
    )
    .join('');
  parts['xl/workbook.xml'] =
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheetEls}</sheets>${spec.workbookAfterSheets ?? ''}</workbook>`;

  const rels = [
    ...spec.sheets.map((s, i) =>
      s.chart
        ? `<Relationship Id="rId${i + 1}" Type="${REL_TYPE('chartsheet')}" Target="chartsheets/sheet${i + 1}.xml"/>`
        : `<Relationship Id="rId${i + 1}" Type="${REL_TYPE('worksheet')}" Target="worksheets/sheet${i + 1}.xml"/>`,
    ),
    hasSst ? `<Relationship Id="rIdSST" Type="${REL_TYPE('sharedStrings')}" Target="sharedStrings.xml"/>` : '',
    hasStyles ? `<Relationship Id="rIdSTY" Type="${REL_TYPE('styles')}" Target="styles.xml"/>` : '',
    spec.workbookRels ?? '',
  ].join('');
  parts['xl/_rels/workbook.xml.rels'] = `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;

  spec.sheets.forEach((s, i) => {
    if (s.chart) parts[`xl/chartsheets/sheet${i + 1}.xml`] = `${XML_DECL}<chartsheet xmlns="${NS_MAIN}"/>`;
    else parts[`xl/worksheets/sheet${i + 1}.xml`] = s.xml ?? worksheetXml(s.rows ?? '', s.after ?? '');
  });
  if (hasSst) parts['xl/sharedStrings.xml'] = spec.sharedStringsXml ?? sharedStringsXml(spec.sharedStrings ?? []);
  if (spec.stylesXml !== undefined) parts['xl/styles.xml'] = spec.stylesXml;
  for (const [name, content] of Object.entries(spec.extraParts ?? {})) parts[name] = content;
  for (const name of spec.omit ?? []) delete parts[name];

  const out: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(parts)) {
    out[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return out;
}

const FIXED_MTIME = new Date(2024, 0, 1, 0, 0, 0);

/** Zip a part map with fflate zipSync (fixed mtime; level 0 stores, default deflates). */
export function zipParts(parts: Record<string, Uint8Array>, level: 0 | 6 = 6): Uint8Array {
  const z: Zippable = {};
  for (const [name, data] of Object.entries(parts)) z[name] = data;
  return zipSync(z, { level, mtime: FIXED_MTIME });
}

/** A minimal valid .xlsx from XML snippets, zipped by fflate zipSync. */
export function buildXlsx(spec: XlsxSpec, level: 0 | 6 = 6): Uint8Array {
  return zipParts(xlsxParts(spec), level);
}

/** One worksheet with the given <sheetData> rows. */
export function singleSheet(rows: string, extra: Omit<XlsxSpec, 'sheets'> = {}, after = ''): Uint8Array {
  return buildXlsx({ ...extra, sheets: [{ name: 'Sheet1', rows, after }] });
}

// ---------------------------------------------------------------------------------------------
// Raw zip writer.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface RawZipEntry {
  name: string;
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflate (default 8). */
  method?: number;
  /** General-purpose flags (bit 0 = encrypted). */
  flags?: number;
  /** Override the uncompressed size written in both headers (a lying header). */
  declaredUncompressedSize?: number;
  /** Already-compressed payload to write instead of compressing `data` (with `method`). */
  rawPayload?: Uint8Array;
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }
  u16(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

const DOS_DATE_1980_01_01 = 0x21;

interface HeaderFields {
  name: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  comp: number;
  uncomp: number;
}

function writeLocalHeader(w: ByteWriter, h: HeaderFields): void {
  w.u32(0x04034b50);
  w.u16(20);
  w.u16(h.flags);
  w.u16(h.method);
  w.u16(0);
  w.u16(DOS_DATE_1980_01_01);
  w.u32(h.crc);
  w.u32(h.comp);
  w.u32(h.uncomp);
  w.u16(h.name.length);
  w.u16(0);
  w.bytes(h.name);
}

function writeCentralRecord(w: ByteWriter, h: HeaderFields, localOffset: number): void {
  w.u32(0x02014b50);
  w.u16(20);
  w.u16(20);
  w.u16(h.flags);
  w.u16(h.method);
  w.u16(0);
  w.u16(DOS_DATE_1980_01_01);
  w.u32(h.crc);
  w.u32(h.comp);
  w.u32(h.uncomp);
  w.u16(h.name.length);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u32(0);
  w.u32(localOffset);
  w.bytes(h.name);
}

function writeEnd(w: ByteWriter, count: number, cdOffset: number): void {
  const cdSize = w.length - cdOffset;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(count);
  w.u16(count);
  w.u32(cdSize);
  w.u32(cdOffset);
  w.u16(0);
}

function headerFor(e: RawZipEntry): { h: HeaderFields; payload: Uint8Array } {
  const data = typeof e.data === 'string' ? strToU8(e.data) : e.data;
  const method = e.method ?? 8;
  const payload = e.rawPayload ?? (method === 8 ? deflateSync(data) : data);
  const flags = (e.flags ?? 0) | (/^[ -~]*$/.test(e.name) ? 0 : 0x800);
  return {
    h: {
      name: strToU8(e.name),
      flags,
      method,
      crc: crc32(data),
      comp: payload.length,
      uncomp: e.declaredUncompressedSize ?? data.length,
    },
    payload,
  };
}

/** Write a zip by hand: local headers, data, central directory, EOCD. */
export function buildRawZip(entries: readonly RawZipEntry[]): Uint8Array {
  const w = new ByteWriter();
  const central: { h: HeaderFields; offset: number }[] = [];
  for (const e of entries) {
    const { h, payload } = headerFor(e);
    const offset = w.length;
    writeLocalHeader(w, h);
    w.bytes(payload);
    central.push({ h, offset });
  }
  const cdOffset = w.length;
  for (const c of central) writeCentralRecord(w, c.h, c.offset);
  writeEnd(w, central.length, cdOffset);
  return w.concat();
}

/**
 * Overlapping-entry zip: entry `outer.xml` (stored) has as its data a complete local header +
 * data for `inner.xml`, and the central directory lists both, so their byte ranges overlap.
 */
export function buildOverlappingZip(): Uint8Array {
  const inner = headerFor({ name: 'inner.xml', data: '<a/>', method: 0 });
  const innerBytes = new ByteWriter();
  writeLocalHeader(innerBytes, inner.h);
  innerBytes.bytes(inner.payload);
  const outer = headerFor({ name: 'outer.xml', data: innerBytes.concat(), method: 0 });

  const w = new ByteWriter();
  writeLocalHeader(w, outer.h);
  const innerOffset = w.length; // inner's local header starts at outer's data
  w.bytes(outer.payload);
  const cdOffset = w.length;
  writeCentralRecord(w, outer.h, 0);
  writeCentralRecord(w, inner.h, innerOffset);
  writeEnd(w, 2, cdOffset);
  return w.concat();
}

/** Raw zip of a full xlsx part map, with per-part overrides (lying sizes, flags, ...). */
export function rawXlsx(spec: XlsxSpec, overrides: Record<string, Partial<RawZipEntry>> = {}, extra: RawZipEntry[] = []): Uint8Array {
  const parts = xlsxParts(spec);
  const entries: RawZipEntry[] = Object.entries(parts).map(([name, data]) => ({ name, data, ...(overrides[name] ?? {}) }));
  return buildRawZip([...entries, ...extra]);
}

/** Run `fn` and return the GateError it throws (undefined if it returns; other errors rethrown). */
export function catchGate(fn: () => unknown): GateError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof GateError) return err;
    throw err;
  }
  return undefined;
}

/** `<c>` helpers for compact fixtures. */
export const num = (ref: string, v: number | string, s?: number): string =>
  `<c r="${ref}"${s !== undefined ? ` s="${s}"` : ''}><v>${v}</v></c>`;
export const fml = (ref: string, f: string, v?: number | string, t?: string): string =>
  `<c r="${ref}"${t ? ` t="${t}"` : ''}><f>${xmlEscape(f)}</f>${v !== undefined ? `<v>${v}</v>` : ''}</c>`;
export const sst = (ref: string, index: number): string => `<c r="${ref}" t="s"><v>${index}</v></c>`;
export const row = (r: number, cells: string): string => `<row r="${r}">${cells}</row>`;

import { strToU8, zipSync, type Zippable } from 'fflate';
import { parseA1, type A1Parts } from '../src/core/util/addr.ts';
import type { SourceCell, SourceSheet, WorkbookSource } from './cellmodel.ts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function fromA1(addr: string): A1Parts {
  const parsed = parseA1(addr);
  if (!parsed || parsed.rowAbs || parsed.colAbs || addr !== addr.toUpperCase()) throw new Error(`Invalid generator cell address: ${addr}`);
  return parsed;
}
/** ZIP stores wall-clock fields: local construction fixes those fields across time zones. */
export const ZIP_TIMESTAMP = { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 } as const;

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sortedCells(sheet: SourceSheet): [string, SourceCell][] {
  return Object.entries(sheet.cells).sort(([a], [b]) => {
    const x = fromA1(a);
    const y = fromA1(b);
    return x.row - y.row || x.col - y.col;
  });
}

function cellXml(addr: string, cell: SourceCell): string {
  fromA1(addr);
  const styleId = cell.style === 'percent' ? 1 : cell.style === 'date' ? 2 : 0;
  const style = styleId === 0 ? '' : ` s="${styleId}"`;
  const formula = cell.formula === undefined ? '' : `<f${cell.arrayRef ? ` t="array" ref="${escapeXml(cell.arrayRef)}"` : ''}>${escapeXml(cell.formula.replace(/^=/, ''))}</f>`;
  if (cell.value === null) return `<c r="${addr}"${style}>${formula}</c>`;
  if (typeof cell.value === 'number' && !Number.isFinite(cell.value)) throw new Error('Non-finite numeric cache.');
  const type = cell.error ? 'e' : typeof cell.value === 'boolean' ? 'b' : typeof cell.value === 'string' ? (cell.formula === undefined ? 'inlineStr' : 'str') : 'n';
  if (cell.error && typeof cell.value !== 'string') throw new Error('Error caches must be error text.');
  const value = type === 'inlineStr'
    ? `<is><t xml:space="preserve">${escapeXml(String(cell.value))}</t></is>`
    : `<v>${escapeXml(typeof cell.value === 'boolean' ? (cell.value ? '1' : '0') : String(cell.value))}</v>`;
  return `<c r="${addr}"${style} t="${type}">${formula}${value}</c>`;
}

function sheetXml(sheet: SourceSheet, comments: boolean): string {
  const rows = new Map<number, string[]>();
  for (const [addr, cell] of sortedCells(sheet)) {
    const row = fromA1(addr).row;
    const group = rows.get(row) ?? [];
    group.push(cellXml(addr, cell));
    rows.set(row, group);
  }
  const body = [...rows].map(([row, cells]) => `<row r="${row}">${cells.join('')}</row>`).join('');
  return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetData>${body}</sheetData>${comments ? '<legacyDrawing r:id="rIdVml"/>' : ''}</worksheet>`;
}

function commentsXml(sheet: SourceSheet): string {
  const comments = Object.entries(sheet.comments).sort(([a], [b]) => {
    const x = fromA1(a);
    const y = fromA1(b);
    return x.row - y.row || x.col - y.col;
  }).map(([addr, text]) => `<comment ref="${addr}" authorId="0"><text><t xml:space="preserve">${escapeXml(text)}</t></text></comment>`).join('');
  return `${XML}<comments xmlns="${MAIN}"><authors><author>S24 synthetic generator</author></authors><commentList>${comments}</commentList></comments>`;
}

function vmlXml(sheet: SourceSheet): string {
  const shapes = Object.keys(sheet.comments).sort().map((addr, index) => {
    const { row, col } = fromA1(addr);
    return `<v:shape id="_x0000_s${1025 + index}" type="#_x0000_t202" style="position:absolute;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${row - 1}</x:Row><x:Column>${col - 1}</x:Column></x:ClientData></v:shape>`;
  }).join('');
  return `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
}

/** Fixed part insertion order, row/column order, XML attributes and ZIP mtimes; no ambient clock. */
export function writeXlsx(source: WorkbookSource): Uint8Array {
  if (source.sheets.length === 0) throw new Error('A workbook needs a sheet.');
  const names = new Set<string>();
  for (const sheet of source.sheets) {
    if (!sheet.name || sheet.name.length > 31 || /[\\/?*\[\]:]/.test(sheet.name)) throw new Error('Invalid sheet name.');
    if (names.has(sheet.name.toLowerCase())) throw new Error('Duplicate sheet name.');
    names.add(sheet.name.toLowerCase());
  }
  const parts: [string, string][] = [];
  const overrides = source.sheets.map((sheet, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${Object.keys(sheet.comments).length ? `<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>` : ''}`).join('');
  parts.push(['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`]);
  parts.push(['_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  parts.push(['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${source.sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`]);
  parts.push(['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}">${source.sheets.map((_sheet, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`]);
  parts.push(['xl/styles.xml', `${XML}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`]);
  source.sheets.forEach((sheet, i) => {
    const index = i + 1;
    const comments = Object.keys(sheet.comments).length > 0;
    parts.push([`xl/worksheets/sheet${index}.xml`, sheetXml(sheet, comments)]);
    if (comments) {
      parts.push([`xl/worksheets/_rels/sheet${index}.xml.rels`, `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rIdComments" Type="${REL}/comments" Target="../comments${index}.xml"/><Relationship Id="rIdVml" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing${index}.vml"/></Relationships>`]);
      parts.push([`xl/comments${index}.xml`, commentsXml(sheet)]);
      parts.push([`xl/drawings/vmlDrawing${index}.vml`, vmlXml(sheet)]);
    }
  });
  const archive: Zippable = {};
  for (const [name, xml] of parts) {
    archive[name] = [strToU8(xml), { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) }];
  }
  return zipSync(archive);
}

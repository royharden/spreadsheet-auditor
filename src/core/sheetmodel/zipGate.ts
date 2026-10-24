// Input gate for .xlsx packages (PLAN §5).
//
// Order of checks, all before any byte is inflated:
//   extension -> compressed size -> OLE/CFB magic -> zip magic -> own EOCD + central-directory
//   parse (zip64 / multi-disk refused) -> part count -> per-entry name rules, encryption,
//   compression method, vbaProject.bin, duplicate names -> declared-size total -> local-header
//   consistency and overlap.
// Inflation is on demand per part with fflate's streaming `Inflate`, fed in small input chunks;
// every output chunk is counted against the running actual-byte cap and the entry's declared
// size, and inflation aborts (throws out of the stream callback) as soon as either is exceeded,
// so a lying header cannot make us materialise more than one chunk's worth past the cap.

import { Inflate } from 'fflate';
import { GateError } from './gateError.ts';
import type { Limits } from './limits.ts';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_MIN = 22;
const CENTRAL_MIN = 46;
const LOCAL_MIN = 30;
const MAX_COMMENT = 0xffff;

/**
 * Compressed bytes handed to the inflater per push. DEFLATE expands at most ~1032:1, so one
 * push can produce at most ~4.2 MB; that is the worst-case overshoot past a cap before abort.
 */
export const INFLATE_INPUT_CHUNK = 4096;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;

export interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  /** Offset of the entry's data, taken from its local header. */
  readonly dataOffset: number;
  readonly isDirectory: boolean;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  /** Case-insensitive lookup (OPC part names are case-insensitive). */
  has(name: string): boolean;
  get(name: string): ZipEntry | undefined;
  /** Inflate one part (cached), enforcing the running actual-byte cap. */
  read(name: string): Uint8Array;
  /** Bytes actually inflated so far, over all parts read. */
  inflatedBytes(): number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function need(b: Uint8Array, offset: number, length: number, what: string): void {
  if (offset < 0 || length < 0 || offset + length > b.length) {
    throw new GateError('bad-zip', `The file is not a readable zip package (truncated ${what}).`);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const MACRO_EXTENSIONS = new Set(['xlsm', 'xlsb', 'xls', 'xltm', 'xlam', 'xla', 'xlt']);

/** Refuse anything but `.xlsx` by file name (macro and legacy formats get a specific message). */
export function checkFileName(fileName: string): void {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'xlsx') return;
  if (MACRO_EXTENSIONS.has(ext)) {
    throw new GateError(
      'unsupported-extension',
      `.${ext} files are not supported: only macro-free .xlsx workbooks can be audited.`,
      { extension: ext },
    );
  }
  throw new GateError(
    'unsupported-extension',
    `Only .xlsx workbooks are supported (this file has ${ext ? `the extension .${ext}` : 'no extension'}).`,
    { extension: ext },
  );
}

function isOle(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

interface Eocd {
  offset: number;
  totalEntries: number;
  cdSize: number;
  cdOffset: number;
}

function findEocd(bytes: Uint8Array): Eocd {
  const last = bytes.length - EOCD_MIN;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let p = last; p >= first; p--) {
    if (u32(bytes, p) !== SIG_EOCD) continue;
    const commentLen = u16(bytes, p + 20);
    if (p + EOCD_MIN + commentLen !== bytes.length) continue;
    const diskNumber = u16(bytes, p + 4);
    const cdDisk = u16(bytes, p + 6);
    const entriesThisDisk = u16(bytes, p + 8);
    const totalEntries = u16(bytes, p + 10);
    const cdSize = u32(bytes, p + 12);
    const cdOffset = u32(bytes, p + 16);
    if (
      totalEntries === 0xffff ||
      entriesThisDisk === 0xffff ||
      cdSize === 0xffffffff ||
      cdOffset === 0xffffffff ||
      (p >= 20 && u32(bytes, p - 20) === SIG_ZIP64_LOCATOR)
    ) {
      throw new GateError('zip64-unsupported', 'ZIP64 packages are not supported (no valid workbook under the size caps needs ZIP64).');
    }
    if (diskNumber !== 0 || cdDisk !== 0 || entriesThisDisk !== totalEntries) {
      throw new GateError('multi-disk-unsupported', 'Split or multi-disk zip archives are not supported.');
    }
    return { offset: p, totalEntries, cdSize, cdOffset };
  }
  throw new GateError('bad-zip', 'The file is not a readable zip package (end-of-central-directory record not found).');
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

function decodeName(raw: Uint8Array): string {
  try {
    return utf8Strict.decode(raw);
  } catch {
    throw new GateError('bad-entry-name', 'A zip entry name is not valid UTF-8.');
  }
}

/** Entry-name rules: no control characters, backslashes, absolute paths or `..` segments. */
export function checkEntryName(name: string): void {
  if (name.length === 0) {
    throw new GateError('bad-entry-name', 'A zip entry has an empty name.');
  }
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new GateError('bad-entry-name', 'A zip entry name contains control characters.');
    }
  }
  if (name.includes('\\')) {
    throw new GateError('backslash-in-name', `Zip entry "${name}" uses a backslash path separator.`, { entry: name });
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new GateError('absolute-path', `Zip entry "${name}" has an absolute path.`, { entry: name });
  }
  if (name.split('/').some((seg) => seg === '..')) {
    throw new GateError('path-traversal', `Zip entry "${name}" contains a ".." path segment.`, { entry: name });
  }
}

/** Any case-insensitive vbaProject.bin (also vbaProjectSignature*.bin) anywhere in the package. */
export function isVbaProjectName(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  return base === 'vbaproject.bin' || (base.startsWith('vbaproject') && base.endsWith('.bin'));
}

/**
 * Structural gate: parse the central directory and enforce every pre-inflation rule.
 * Returns an archive whose `read` inflates parts lazily under the actual-byte cap.
 */
export function openZip(bytes: Uint8Array, limits: Limits, fileName?: string): ZipArchive {
  if (fileName !== undefined) checkFileName(fileName);

  if (bytes.length > limits.maxCompressedBytes) {
    throw new GateError(
      'compressed-too-large',
      `The file is ${bytes.length} bytes; the limit is ${limits.maxCompressedBytes} bytes.`,
      { bytes: bytes.length, limit: limits.maxCompressedBytes },
    );
  }
  if (isOle(bytes)) {
    throw new GateError(
      'ole-compound-file',
      'This is an OLE compound file (a legacy .xls, or a password-protected workbook): only unencrypted .xlsx is supported.',
    );
  }
  if (bytes.length < EOCD_MIN || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new GateError('not-zip', 'The file is not an .xlsx (zip) package.');
  }

  const eocd = findEocd(bytes);
  if (eocd.totalEntries > limits.maxParts) {
    throw new GateError(
      'too-many-parts',
      `The package has ${eocd.totalEntries} parts; the limit is ${limits.maxParts}.`,
      { parts: eocd.totalEntries, limit: limits.maxParts },
    );
  }
  if (eocd.cdOffset + eocd.cdSize > eocd.offset) {
    throw new GateError('bad-zip', 'The zip central directory overlaps its end record.');
  }

  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let p = eocd.cdOffset;
  const cdEnd = eocd.cdOffset + eocd.cdSize;

  for (let i = 0; i < eocd.totalEntries; i++) {
    need(bytes, p, CENTRAL_MIN, 'central directory');
    if (p + CENTRAL_MIN > cdEnd || u32(bytes, p) !== SIG_CENTRAL) {
      throw new GateError('bad-zip', 'The zip central directory is corrupt.');
    }
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const diskStart = u16(bytes, p + 34);
    const localHeaderOffset = u32(bytes, p + 42);
    need(bytes, p + CENTRAL_MIN, nameLen + extraLen + commentLen, 'central directory entry');
    const rawName = bytes.subarray(p + CENTRAL_MIN, p + CENTRAL_MIN + nameLen);
    p += CENTRAL_MIN + nameLen + extraLen + commentLen;
    if (p > cdEnd) {
      throw new GateError('bad-zip', 'The zip central directory is corrupt.');
    }

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new GateError('zip64-unsupported', 'ZIP64 entries are not supported.');
    }
    if (diskStart !== 0) {
      throw new GateError('multi-disk-unsupported', 'Split or multi-disk zip archives are not supported.');
    }

    const name = decodeName(rawName);
    checkEntryName(name);
    const key = name.toLowerCase();
    if (byName.has(key)) {
      throw new GateError('duplicate-entry', `The package contains "${name}" more than once.`, { entry: name });
    }
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION) || method === METHOD_AES) {
      throw new GateError('encrypted-entry', `Zip entry "${name}" is encrypted.`, { entry: name });
    }
    if (isVbaProjectName(name)) {
      throw new GateError('vba-project', 'The package contains a VBA project (macros); only macro-free .xlsx is supported.', {
        entry: name,
      });
    }
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new GateError('unsupported-compression', `Zip entry "${name}" uses unsupported compression method ${method}.`, {
        entry: name,
        method,
      });
    }
    if (method === METHOD_STORED && compressedSize !== uncompressedSize) {
      throw new GateError('entry-size-mismatch', `Stored zip entry "${name}" has inconsistent sizes.`, { entry: name });
    }

    declaredTotal += uncompressedSize;
    if (declaredTotal > limits.maxDeclaredBytes) {
      throw new GateError(
        'declared-too-large',
        `The package declares more than ${limits.maxDeclaredBytes} uncompressed bytes.`,
        { declaredBytes: declaredTotal, limit: limits.maxDeclaredBytes },
      );
    }

    // Local header must agree with the central directory on the name; data must lie before the CD.
    need(bytes, localHeaderOffset, LOCAL_MIN, 'local header');
    if (u32(bytes, localHeaderOffset) !== SIG_LOCAL) {
      throw new GateError('bad-zip', `Zip entry "${name}" has no local header.`, { entry: name });
    }
    const localFlags = u16(bytes, localHeaderOffset + 6);
    if (localFlags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) {
      throw new GateError('encrypted-entry', `Zip entry "${name}" is encrypted.`, { entry: name });
    }
    const localNameLen = u16(bytes, localHeaderOffset + 26);
    const localExtraLen = u16(bytes, localHeaderOffset + 28);
    need(bytes, localHeaderOffset + LOCAL_MIN, localNameLen + localExtraLen, 'local header');
    const localName = bytes.subarray(localHeaderOffset + LOCAL_MIN, localHeaderOffset + LOCAL_MIN + localNameLen);
    if (!sameBytes(localName, rawName)) {
      throw new GateError('bad-zip', `Zip entry "${name}" has a local header that disagrees with the central directory.`, {
        entry: name,
      });
    }
    const dataOffset = localHeaderOffset + LOCAL_MIN + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > eocd.cdOffset) {
      throw new GateError('bad-zip', `Zip entry "${name}" extends past the start of the central directory.`, { entry: name });
    }

    const isDirectory = name.endsWith('/');
    if (isDirectory && uncompressedSize !== 0) {
      throw new GateError('bad-zip', `Zip directory entry "${name}" has content.`, { entry: name });
    }

    const entry: ZipEntry = {
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
      isDirectory,
    };
    entries.push(entry);
    byName.set(key, entry);
  }

  if (p !== cdEnd) {
    throw new GateError('bad-zip', 'The zip central directory size does not match its entries.');
  }

  // Overlapping entries (several central records pointing into the same bytes) are a bomb pattern.
  const ordered = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    if (prev.dataOffset + prev.compressedSize > ordered[i].localHeaderOffset) {
      throw new GateError('overlapping-entries', 'Zip entries overlap each other.', {
        entry: ordered[i].name,
      });
    }
  }

  let inflatedTotal = 0;
  const cache = new Map<string, Uint8Array>();

  function count(entry: ZipEntry, entryBytes: number, added: number): void {
    inflatedTotal += added;
    if (inflatedTotal > limits.maxInflatedBytes) {
      throw new GateError(
        'inflated-too-large',
        `Decompressing the package exceeded the ${limits.maxInflatedBytes}-byte limit; reading stopped.`,
        { inflatedBytes: inflatedTotal, limit: limits.maxInflatedBytes, entry: entry.name },
      );
    }
    if (entryBytes > entry.uncompressedSize) {
      throw new GateError(
        'entry-size-mismatch',
        `Part "${entry.name}" decompresses to more bytes than its header declares; reading stopped.`,
        { inflatedBytes: inflatedTotal, entryBytes, declared: entry.uncompressedSize, entry: entry.name },
      );
    }
  }

  function inflateEntry(entry: ZipEntry, src: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    let finished = false;
    const inflater = new Inflate((chunk: Uint8Array, final: boolean) => {
      entryBytes += chunk.length;
      count(entry, entryBytes, chunk.length); // throws -> aborts the stream
      if (chunk.length > 0) chunks.push(chunk);
      if (final) finished = true;
    });
    try {
      if (src.length === 0) {
        inflater.push(new Uint8Array(0), true);
      }
      for (let off = 0; off < src.length; off += INFLATE_INPUT_CHUNK) {
        const end = Math.min(off + INFLATE_INPUT_CHUNK, src.length);
        inflater.push(src.subarray(off, end), end === src.length);
      }
    } catch (err) {
      if (err instanceof GateError) throw err;
      throw new GateError('corrupt-entry', `Part "${entry.name}" could not be decompressed.`, { entry: entry.name });
    }
    if (!finished) {
      throw new GateError('corrupt-entry', `Part "${entry.name}" ended before its compressed data was complete.`, {
        entry: entry.name,
      });
    }
    if (entryBytes !== entry.uncompressedSize) {
      throw new GateError(
        'entry-size-mismatch',
        `Part "${entry.name}" decompresses to a different size than its header declares.`,
        { entryBytes, declared: entry.uncompressedSize, entry: entry.name },
      );
    }
    const out = new Uint8Array(entryBytes);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  return {
    entries,
    has(name: string): boolean {
      return byName.has(name.toLowerCase());
    },
    get(name: string): ZipEntry | undefined {
      return byName.get(name.toLowerCase());
    },
    read(name: string): Uint8Array {
      const key = name.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const entry = byName.get(key);
      if (!entry) {
        throw new GateError('missing-part', `The package has no part "${name}".`, { part: name });
      }
      let out: Uint8Array;
      if (entry.isDirectory) {
        out = new Uint8Array(0);
      } else {
        const src = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
        if (entry.method === METHOD_STORED) {
          count(entry, src.length, src.length);
          out = src.slice();
        } else {
          out = inflateEntry(entry, src);
        }
      }
      cache.set(key, out);
      return out;
    },
    inflatedBytes(): number {
      return inflatedTotal;
    },
  };
}

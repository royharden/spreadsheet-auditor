import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256Hex, toHex, utf8Encode } from './sha256.ts';

describe('sha256Hex (FIPS 180-4 known vectors)', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "abc" (one block)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes the 448-bit two-block message', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes "The quick brown fox jumps over the lazy dog"', () => {
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('hashes one million "a" (many full blocks)', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('sha256 input forms', () => {
  it('gives the same digest for a string and its UTF-8 bytes', () => {
    const text = 'Zürich – 5% ✓';
    expect(sha256Hex(utf8Encode(text))).toBe(sha256Hex(text));
  });

  it('hashes non-ASCII text as UTF-8', () => {
    expect(sha256Hex('é')).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
  });

  it('returns 32 raw bytes whose hex is the hex digest', () => {
    const raw = sha256Bytes('abc');
    expect(raw).toHaveLength(32);
    expect(toHex(raw)).toBe(sha256Hex('abc'));
  });

  it('pads correctly around the 55/56/64-byte boundaries (bytes and string agree, all distinct)', () => {
    const lengths = [55, 56, 57, 63, 64, 65, 119, 120];
    const digests = lengths.map((n) => sha256Hex(new Uint8Array(n).fill(0x61)));
    expect(new Set(digests).size).toBe(lengths.length);
    expect(digests).toEqual(lengths.map((n) => sha256Hex('a'.repeat(n))));
    for (const d of digests) expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not mutate its input', () => {
    const input = new Uint8Array([1, 2, 3]);
    sha256Hex(input);
    expect([...input]).toEqual([1, 2, 3]);
  });
});

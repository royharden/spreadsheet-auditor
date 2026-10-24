// Synchronous, dependency-free SHA-256 (FIPS 180-4) over bytes or UTF-8 text.
// Pure TypeScript with no imports, so rules stay synchronous and the file can be
// copied verbatim into the edge function's _shared folder (Deno).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 encode a string (TextEncoder exists in browsers, Node >= 11 and Deno). */
export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function compress(h: Uint32Array, w: Uint32Array, block: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4;
    w[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const w15 = w[i - 15];
    const w2 = w[i - 2];
    const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  // Uint32Array stores modulo 2^32.
  h[0] += a;
  h[1] += b;
  h[2] += c;
  h[3] += d;
  h[4] += e;
  h[5] += f;
  h[6] += g;
  h[7] += hh;
}

/** SHA-256 digest as 32 raw bytes. Strings are hashed as their UTF-8 encoding. */
export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  const msg = typeof input === 'string' ? utf8Encode(input) : input;
  const len = msg.length;
  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);

  const fullBlocks = Math.floor(len / 64);
  for (let blk = 0; blk < fullBlocks; blk++) {
    compress(h, w, msg, blk * 64);
  }

  // Padding: remaining bytes, 0x80, zeros, 64-bit big-endian bit length.
  const tailLen = len - fullBlocks * 64;
  const tail = new Uint8Array(tailLen + 9 <= 64 ? 64 : 128);
  tail.set(msg.subarray(fullBlocks * 64));
  tail[tailLen] = 0x80;
  const bitLenHi = Math.floor(len / 0x20000000); // (len * 8) / 2^32
  const bitLenLo = (len * 8) >>> 0;
  const end = tail.length;
  tail[end - 8] = bitLenHi >>> 24;
  tail[end - 7] = bitLenHi >>> 16;
  tail[end - 6] = bitLenHi >>> 8;
  tail[end - 5] = bitLenHi;
  tail[end - 4] = bitLenLo >>> 24;
  tail[end - 3] = bitLenLo >>> 16;
  tail[end - 2] = bitLenLo >>> 8;
  tail[end - 1] = bitLenLo;
  for (let off = 0; off < tail.length; off += 64) {
    compress(h, w, tail, off);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const v = h[i];
    out[i * 4] = v >>> 24;
    out[i * 4 + 1] = v >>> 16;
    out[i * 4 + 2] = v >>> 8;
    out[i * 4 + 3] = v;
  }
  return out;
}

/** Lower-case hex encoding of bytes. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/** SHA-256 as 64 lower-case hex characters. */
export function sha256Hex(input: Uint8Array | string): string {
  return toHex(sha256Bytes(input));
}

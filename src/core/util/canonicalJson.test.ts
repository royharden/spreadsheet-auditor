import { describe, expect, it } from 'vitest';
import { canonicalJson, utf8ByteLength } from './canonicalJson.ts';

describe('canonicalJson', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }], m: { z: true, y: null } })).toBe(
      '{"a":[{"c":"x","d":2}],"b":1,"m":{"y":null,"z":true}}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits undefined members and writes undefined array items as null', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
  });

  it('escapes strings exactly like JSON.stringify', () => {
    const value = { 'k"ey': 'line\nbreak "q" \u0001' };
    expect(canonicalJson(value)).toBe(JSON.stringify(value));
    expect(canonicalJson(value)).toBe('{"k\\"ey":"line\\nbreak \\"q\\" \\u0001"}');
  });

  it('sorts keys by UTF-16 code units (uppercase before lowercase)', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}');
  });

  it('allows the same object twice (not a cycle)', () => {
    const shared = { v: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });

  it('accepts null-prototype objects', () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.z = 1;
    o.a = 2;
    expect(canonicalJson(o)).toBe('{"a":2,"z":1}');
  });

  it('rejects non-plain data', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ n: Infinity })).toThrow(TypeError);
    expect(() => canonicalJson({ m: new Map() })).toThrow(TypeError);
    expect(() => canonicalJson({ d: new Date(0) })).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
    expect(() => canonicalJson({ b: BigInt(1) })).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it('rejects cycles', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/cyclic/);
  });
});

describe('utf8ByteLength', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('✓')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

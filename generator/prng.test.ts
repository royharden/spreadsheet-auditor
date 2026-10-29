import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng.ts';

describe('seeded random source', () => {
  it('repeats from a seed, varies with a different seed, and stays inside integer bounds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const values = Array.from({ length: 100 }, () => a.int(-2, 2));
    expect(values).toEqual(Array.from({ length: 100 }, () => b.int(-2, 2)));
    expect(values).not.toEqual(Array.from({ length: 100 }, () => c.int(-2, 2)));
    expect(values.every((value) => Number.isInteger(value) && value >= -2 && value <= 2)).toBe(true);
    expect(mulberry32(0).int(5, 5)).toBe(5);
  });

  it('refuses lossy seeds and invalid integer ranges', () => {
    for (const seed of [-1, 0x100000000, 0.5, NaN]) expect(() => mulberry32(seed)).toThrow();
    expect(() => mulberry32(0).int(4, 3)).toThrow();
    expect(() => mulberry32(0).int(0, 1.5)).toThrow();
  });
});

/** Mulberry32: identical uint32 seed and call order produce identical numbers. */
export interface Random {
  next(): number;
  int(min: number, max: number): number;
}

export function mulberry32(seed: number): Random {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32.');
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new Error('Invalid integer range.');
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}

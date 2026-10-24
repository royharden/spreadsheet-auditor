export interface Interval { low: number; high: number }
export const Z_95 = 1.959963984540054;

/** Score interval for a binomial proportion. No trials means unavailable, never zero. */
export function wilson95(successes: number, trials: number): Interval | null {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(trials) || successes < 0 || trials < successes) throw new Error('Invalid binomial counts.');
  if (trials === 0) return null;
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const divisor = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / divisor;
  const half = Z_95 * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / divisor;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

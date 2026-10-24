import { describe, expect, it } from 'vitest';
import { numbersInFormula, numbersInText, sameNumber, scanNumbers } from './pointer.ts';

describe('numeric grounding helpers', () => {
  it('keeps overflowing and unsupported claims in the scan so the checker can reject them', () => {
    const claims = scanNumbers(`1e999 ${'9'.repeat(400)} 1e+ Infinity`);
    expect(claims).toHaveLength(4);
    expect(claims.every((claim) => !Number.isFinite(claim.value))).toBe(true);
  });
  it('excludes nonfinite numbers from text and formula grounding', () => {
    expect(numbersInText('Magnitude 1e9, overflow 1e999, unsupported 1e+.')).toEqual([1e9]);
    expect(numbersInFormula('=1e9+1e999+"2e3 and 1e999"')).toEqual([1e9, 2e3]);
  });
  it('never treats matching nonfinite values as grounded numbers', () => {
    expect(sameNumber(Infinity, Infinity)).toBe(false);
    expect(sameNumber(-Infinity, -Infinity)).toBe(false);
    expect(sameNumber(NaN, NaN)).toBe(false);
    expect(sameNumber(0.05, 5e-2)).toBe(true);
  });
});

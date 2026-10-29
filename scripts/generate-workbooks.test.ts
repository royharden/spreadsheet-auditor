import { describe, expect, it } from 'vitest';
import { parseGenerateArgs } from './generate-workbooks.ts';

describe('activation-only generator CLI arguments', () => {
  it('requires an explicit freeze flag and accepts the full uint32 seed range', () => {
    expect(parseGenerateArgs([]).freeze).toBe(false);
    expect(parseGenerateArgs(['--seed', '4294967295', '--freeze'])).toMatchObject({ seed: 0xffffffff, freeze: true });
  });

  it('rejects missing, unknown, negative or lossy arguments before generation', () => {
    for (const args of [['--seed'], ['--seed', '-1'], ['--seed', '0.5'], ['--seed', '4294967296'], ['--output'], ['--unknown']]) {
      expect(() => parseGenerateArgs(args)).toThrow();
    }
  });
});

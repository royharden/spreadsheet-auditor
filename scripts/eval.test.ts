import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from './eval.ts';

describe('evaluation CLI arguments', () => {
  it('accepts the split, systems, count inspection and recording flags without running evaluation', () => {
    expect(parseEvalArgs(['--split', 'heldout', '--systems', '3,1,2', '--record'])).toMatchObject({ split: 'heldout', systems: ['1', '2', '3'], record: true, countsOnly: false });
    expect(parseEvalArgs(['--counts-only'])).toMatchObject({ split: 'dev', systems: ['1'], countsOnly: true, record: false });
  });
  it('refuses unknown, repeated and missing options', () => {
    for (const args of [['--split'], ['--split', 'test'], ['--systems', '4'], ['--systems', '1,1'], ['--systems', ''], ['--unknown']]) expect(() => parseEvalArgs(args)).toThrow();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public environment template', () => {
  it('exposes only empty public connection placeholders, never provider secrets', () => {
    const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const assignments = source.split(/\r?\n/).flatMap((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      return match ? [{ name: match[1], value: match[2] }] : [];
    });
    expect(assignments).toEqual([
      { name: 'VITE_SUPABASE_URL', value: '' },
      { name: 'VITE_SUPABASE_ANON_KEY', value: '' },
    ]);
    expect(source).not.toMatch(/^VITE_.*(?:SECRET|PASSWORD|SERVICE_ROLE|ANTHROPIC|TYPESAFE)/m);
  });
});

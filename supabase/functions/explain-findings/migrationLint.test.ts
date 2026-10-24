import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration static privacy and ownership contract', () => {
  it('enables RLS on every created table and gives quota tables no client policies', async () => {
    const root = resolve('supabase/migrations');
    for (const file of (await readdir(root)).filter((name) => name.endsWith('.sql'))) {
      const sql = await readFile(resolve(root, file), 'utf8');
      for (const match of sql.matchAll(/create\s+table\s+public\.(\w+)/gi)) expect(sql.toLowerCase()).toContain(`alter table public.${match[1].toLowerCase()} enable row level security`);
      if (file.includes('explain_quota')) expect(sql).not.toMatch(/create\s+policy/i);
    }
  });
  it('requires same-owner link/version lineage and stores only note presence', async () => {
    const sql = await readFile(resolve('supabase/migrations/20261024000100_rulings.sql'), 'utf8');
    for (const required of ['primary key (user_id, workbook_sha256)', 'event_id uuid unique not null', 'has_note boolean', 'insertion_order bigint generated always as identity',
      'target.user_id = auth.uid()', 'target.lineage_id = workbook_versions.lineage_id', 'version.user_id = auth.uid()', 'version.lineage_id = rulings.lineage_id', 'for select to authenticated', 'for insert to authenticated']) expect(sql).toContain(required);
    expect(sql).not.toMatch(/create\s+policy[\s\S]*?for\s+(update|delete|all)\b/i);
    expect(sql).not.toMatch(/^\s*(?:note|formula|value|bundle)\s+(?:text|jsonb?)/im);
  });
});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('quota migration static contract (database behavior remains unexecuted)', () => {
  it('protects every counter/config/reservation table with RLS and no client policies', async () => {
    const sql = await readFile(resolve('supabase/migrations/20261024000200_explain_quota.sql'), 'utf8');
    for (const table of ['explain_quota_config', 'explain_quota_user', 'explain_quota_global', 'explain_reservations']) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toContain('values (true, 1000, 10000)');
    expect(sql).toContain('request_id uuid primary key');
  });
  it('pins identity/search_path, reserves two attempts, fails missing config, and guards inserts plus updates', async () => {
    const sql = await readFile(resolve('supabase/migrations/20261024000200_explain_quota.sql'), 'utf8');
    for (const source of ['auth.uid()', 'security definer', 'set search_path = public, pg_temp', 'Quota configuration missing', 'v_attempts := 2::bigint * p_n', 'p_n < 1 or p_n > 200',
      'select v_day, v_attempts where v_attempts <= v_global_cap', 'where g.bundles_reserved + excluded.bundles_reserved <= v_global_cap',
      'select v_user, v_day, v_attempts where v_attempts <= v_user_cap', 'where u.bundles_reserved + excluded.bundles_reserved <= v_user_cap',
      'revoke all on function public.reserve_explain_quota(uuid, integer) from public', 'grant execute on function public.reserve_explain_quota(uuid, integer) to authenticated']) expect(sql).toContain(source);
    expect(sql.indexOf('insert into public.explain_quota_global')).toBeLessThan(sql.indexOf('insert into public.explain_quota_user'));
  });
});

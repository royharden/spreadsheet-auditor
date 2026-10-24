import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ fixtureClient: true })) }));

describe('optional public connection configuration', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('keeps a fresh clone local and exports no function URL until both public values exist', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.resetModules();
    const module = await import('./supabase.ts');
    expect(module.supabase).toBeNull();
    expect(module.explainFunctionUrl).toBeNull();
  });
  it('centralizes the function URL without provider secrets', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.invalid/'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-key');
    vi.resetModules();
    const module = await import('./supabase.ts');
    expect(module.supabase).not.toBeNull();
    expect(module.explainFunctionUrl).toBe('https://project.invalid/functions/v1/explain-findings');
  });
});

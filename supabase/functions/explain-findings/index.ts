import { createClient } from '@supabase/supabase-js';
import { createHandler, type ServerConfig } from './handler.ts';
import { createSingleAttemptTransport } from './transport.ts';

function callerClient(jwt: string) {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Authentication configuration unavailable.');
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function config(): ServerConfig {
  return {
    anthropicApiKey: Deno.env.get('ANTHROPIC_API_KEY'), typesafeApiKey: Deno.env.get('TYPESAFE_API_KEY'),
    explainModel: Deno.env.get('EXPLAIN_MODEL'), jevModel: Deno.env.get('JEV_MODEL'),
    maxOutputTokens: Deno.env.get('EXPLAIN_MAX_TOKENS'),
  };
}

Deno.serve(createHandler({
  async authenticate(jwt) {
    const { data, error } = await callerClient(jwt).auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  config,
  async reserve(jwt, requestId, n) {
    const { data, error } = await callerClient(jwt).rpc('reserve_explain_quota', { p_request_id: requestId, p_n: n });
    if (error || typeof data !== 'number') throw new Error('Quota reservation unavailable.');
    return data;
  },
  invokeProvider: createSingleAttemptTransport(),
}));

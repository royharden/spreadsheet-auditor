import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
/** A fresh clone remains local until both public connection values are supplied. */
export const supabase = url && publicKey ? createClient(url, publicKey) : null;
export const explainFunctionUrl: string | null = url && publicKey ? `${url.replace(/\/+$/, '')}/functions/v1/explain-findings` : null;

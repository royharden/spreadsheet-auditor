import { z } from 'zod';
import type { Bundle } from '../evidence/bundle.ts';
import { PROMPT_VERSION, type TriageArm } from '../explain/prompt.ts';
import { TRIAGE_SCHEMA_VERSION, TriageResultSchema, type TriageResult } from '../explain/triageSchema.ts';
import { canonicalJson } from '../util/canonicalJson.ts';
import { sha256Hex } from '../util/sha256.ts';
export interface CacheContext { promptVersion: string; schemaVersion: string; arm: TriageArm; model: string }
const EntrySchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), origin: z.enum(['synthetic-test', 'recorded-live']), promptVersion: z.string(), schemaVersion: z.string(), arm: z.enum(['generative', 'jev']), model: z.string().min(1), response: TriageResultSchema }).strict();
const CacheSchema = z.object({ version: z.literal(1), entries: z.array(EntrySchema) }).strict();
export type CacheEntry = z.infer<typeof EntrySchema>;
export type ModelCache = z.infer<typeof CacheSchema>;
export function cacheContext(arm: TriageArm, model: string): CacheContext { return { promptVersion: PROMPT_VERSION, schemaVersion: TRIAGE_SCHEMA_VERSION, arm, model }; }
export function cacheKey(bundle: Bundle, context: CacheContext): string { return sha256Hex(canonicalJson({ bundle, ...context })); }
export function parseCache(value: unknown): ModelCache {
  const cache = CacheSchema.parse(value);
  if (new Set(cache.entries.map((entry) => entry.key)).size !== cache.entries.length) throw new Error('Duplicate cache key.');
  return cache;
}
export function cacheEntry(bundle: Bundle, context: CacheContext, response: TriageResult, origin: CacheEntry['origin']): CacheEntry {
  return EntrySchema.parse({ ...context, key: cacheKey(bundle, context), response, origin });
}

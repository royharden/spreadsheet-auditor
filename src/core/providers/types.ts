import type { Bundle } from '../evidence/bundle.ts';
import type { TriageArm } from '../explain/prompt.ts';
import type { TriageResult } from '../explain/triageSchema.ts';
export type CacheOrigin = 'synthetic-test' | 'recorded-live';
export interface TriageRequest { requestId: string; arm: TriageArm; model: string; bundles: readonly Bundle[] }
export interface TriageProvider { readonly origin: CacheOrigin | 'live'; triage(request: TriageRequest): Promise<TriageResult[]> }
export type FetchTransport = (url: string, init: RequestInit) => Promise<Response>;
export interface AttemptUsage { inputTokens: number | null; outputTokens: number | null; latencyMs: number; status: 'live' | 'error' }
export interface ProviderOptions { apiKey: string; model: string; transport: FetchTransport; onAttempt?: (usage: AttemptUsage) => void; retries?: 0 | 1; maxTokens?: number }

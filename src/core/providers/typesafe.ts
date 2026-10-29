// Based on the INT's official-docs reference, 2026-10-24. Runtime unverified.
import { buildTypeSafeRequest, type Choice } from '../explain/prompt.ts';
import { parseTypeSafeResponse } from '../explain/triageSchema.ts';
import { providerJson } from './http.ts';
import type { ProviderOptions, TriageProvider } from './types.ts';
export function createTypeSafeProvider(options: ProviderOptions & { minConfidence?: number; criteriaOrder?: readonly Choice[] }): TriageProvider {
  return { origin: 'live', async triage(request) {
    if (request.arm !== 'jev' || request.model !== options.model) throw new Error('Provider arm/model mismatch.');
    return providerJson(options, 'https://api.typesafe.ai/v1/systemone', buildTypeSafeRequest(options.model, request.bundles, options.criteriaOrder),
      { authorization: `Bearer ${options.apiKey}` }, (value) => parseTypeSafeResponse(value, request.bundles, options.minConfidence));
  } };
}

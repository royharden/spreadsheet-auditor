import { cacheContext, cacheKey, type ModelCache } from './cache.ts';
import type { TriageProvider } from './types.ts';
export class MockCacheMiss extends Error { constructor(id: string) { super(`MockCacheMiss: no recorded response for finding ${id}`); this.name = 'MockCacheMiss'; } }
export function createMockProvider(cache: ModelCache): TriageProvider {
  return { origin: cache.entries.some((entry) => entry.origin === 'synthetic-test') ? 'synthetic-test' : 'recorded-live',
    async triage(request) {
      return request.bundles.map((bundle) => {
        const context = cacheContext(request.arm, request.model);
        const entry = cache.entries.find((item) => item.key === cacheKey(bundle, context) && item.arm === context.arm && item.model === context.model && item.promptVersion === context.promptVersion && item.schemaVersion === context.schemaVersion);
        if (!entry || entry.response.findingId !== bundle.findingId || entry.response.bundleSha256 !== bundle.sha256) throw new MockCacheMiss(bundle.findingId);
        return { ...entry.response, cited_cells: [...entry.response.cited_cells] };
      });
    } };
}

import { MAX_REQUEST_BYTES } from '../explain/limits.ts';
import { parseTriageResponse } from '../explain/triageSchema.ts';
import { utf8ByteLength } from '../util/canonicalJson.ts';
import type { FetchTransport, TriageProvider } from './types.ts';
export interface EdgeOptions { url: string; accessToken: () => Promise<string>; transport: FetchTransport }
/** Browser sends bounded bundles only, never workbook bytes or provider credentials. No client
 * retry: the edge invocation already owns its single reserved retry. */
export function createEdgeProvider(options: EdgeOptions): TriageProvider {
  return { origin: 'live', async triage(request) {
    const body = JSON.stringify({ requestId: request.requestId, arm: request.arm, bundles: request.bundles });
    if (utf8ByteLength(body) > MAX_REQUEST_BYTES) throw new Error('Request body exceeds the model limit.');
    const token = await options.accessToken();
    if (!token) throw new Error('Sign in before live triage.');
    const response = await options.transport(options.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    if (!response.ok) throw new Error(`Explanation function HTTP ${response.status}`);
    const value = await response.json() as { results?: unknown };
    return parseTriageResponse(value.results);
  } };
}
export async function edgeReadiness(options: EdgeOptions): Promise<{ configured: boolean; reasons: string[] }> {
  const token = await options.accessToken();
  if (!token) return { configured: false, reasons: ['Sign in before live triage.'] };
  const response = await options.transport(options.url, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return { configured: false, reasons: [`Readiness HTTP ${response.status}`] };
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') return { configured: false, reasons: ['Malformed readiness response.'] };
  const raw = value as { configured?: unknown; reasons?: unknown };
  if (typeof raw.configured !== 'boolean' || !Array.isArray(raw.reasons) || raw.reasons.some((reason) => typeof reason !== 'string')) return { configured: false, reasons: ['Malformed readiness response.'] };
  return { configured: raw.configured, reasons: raw.reasons as string[] };
}

// Test-only browser boundary doubles; never imported by production components.
import { vi } from 'vitest';
import { handleAuditRequest, type AuditRequest, type AuditResponse } from '../worker/protocol.ts';
import type { AuthGateway, AuthSession } from './auth.ts';
export class AutoWorker {
  onmessage: ((event: MessageEvent<AuditResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage(request: AuditRequest): void { queueMicrotask(() => this.onmessage?.({ data: handleAuditRequest(request) } as MessageEvent<AuditResponse>)); }
}
export const testWorker = (): Worker => new AutoWorker() as unknown as Worker;
export const sessionA: AuthSession = { access_token: 'test-token-a', user: { id: 'user-a', email: 'a@example.test' } };
export const sessionB: AuthSession = { access_token: 'test-token-b', user: { id: 'user-b', email: 'b@example.test' } };
export class FakeAuth implements AuthGateway {
  listener: ((event: string, session: AuthSession | null) => void) | null = null;
  session: AuthSession | null;
  constructor(session: AuthSession | null = null) { this.session = session; }
  getSession = vi.fn(async () => ({ data: { session: this.session }, error: null }));
  unsubscribe = vi.fn();
  onAuthStateChange(callback: (event: string, session: AuthSession | null) => void) {
    this.listener = callback;
    return { data: { subscription: { unsubscribe: () => { this.listener = null; this.unsubscribe(); } } } };
  }
  emit(event: string, session: AuthSession | null): void { this.session = session; this.listener?.(event, session); }
  signInWithPassword = vi.fn(async (_value: { email: string; password: string }) => { this.emit('SIGNED_IN', sessionA); return { error: null }; });
  signUp = vi.fn(async (_value: { email: string; password: string }) => ({ error: null }));
  signOut = vi.fn(async () => { this.emit('SIGNED_OUT', null); return { error: null }; });
  resetPasswordForEmail = vi.fn(async (_email: string, _options: { redirectTo: string }) => ({ error: null }));
  updateUser = vi.fn(async (_value: { password: string }) => ({ error: null }));
}

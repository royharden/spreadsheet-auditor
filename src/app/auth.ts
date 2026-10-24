import { useEffect, useState } from 'react';
/** Minimal, fakeable slice of Supabase Auth. Never holds provider API credentials. */
export interface AuthSession { access_token: string; user: { id: string; email?: string } }
interface AuthResult { error: { message: string } | null }
export interface AuthGateway {
  getSession(): Promise<AuthResult & { data: { session: AuthSession | null } }>;
  onAuthStateChange(callback: (event: string, session: AuthSession | null) => void): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(value: { email: string; password: string }): Promise<AuthResult>;
  signUp(value: { email: string; password: string }): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<AuthResult>;
  updateUser(value: { password: string }): Promise<AuthResult>;
}
export function useAuth(auth: AuthGateway | null) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [loading, setLoading] = useState(Boolean(auth));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let eventSeen = false;
    setSession(null); setRecovering(false); setError(null); setLoading(Boolean(auth));
    if (!auth) return () => { active = false; };
    const { data } = auth.onAuthStateChange((event, next) => {
      if (!active) return;
      eventSeen = true;
      // Auth callbacks stay synchronous. Storage and readiness run in separate effects.
      setSession(next); setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });
    void auth.getSession().then((result) => {
      if (!active || eventSeen) return;
      setSession(result.data.session); setLoading(false);
      if (result.error) setError(result.error.message);
    }).catch(() => { if (active && !eventSeen) { setLoading(false); setError('Session restore failed.'); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [auth]);
  return { session, recovering, setRecovering, loading, error };
}

import { useState } from 'react';
import type { AuthGateway, AuthSession } from '../auth.ts';
export function AuthPanel({ auth, session, recovering, onRecovered }: { auth: AuthGateway | null; session: AuthSession | null; recovering: boolean; onRecovered: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function action(kind: 'signin' | 'signup' | 'signout' | 'reset' | 'update'): Promise<void> {
    if (!auth || busy) return;
    setBusy(true); setMessage(null);
    try {
      const result = kind === 'signin' ? await auth.signInWithPassword({ email, password }) : kind === 'signup' ? await auth.signUp({ email, password })
        : kind === 'signout' ? await auth.signOut() : kind === 'update' ? await auth.updateUser({ password })
          : await auth.resetPasswordForEmail(email, { redirectTo: `${globalThis.location.origin}${globalThis.location.pathname}?recovery=1` });
      if (result.error) throw new Error(result.error.message);
      setPassword('');
      if (kind === 'update') onRecovered();
      setMessage(kind === 'reset' || kind === 'signup' ? 'Check your email for the next step.' : kind === 'update' ? 'Password updated.' : 'Account action completed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Account action failed.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Account"><h2>Account</h2>
    {!auth ? <p>Cloud rulings and Live require backend configuration.</p> : recovering ? <>
      <h3>Set a new password</h3><label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="button" disabled={busy || !session || !password} onClick={() => { void action('update'); }}>Save new password</button>
    </> : session ? <><p>Signed in as {session.user.email ?? session.user.id}</p><button type="button" disabled={busy} onClick={() => { void action('signout'); }}>Sign out</button></> : <>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="button" disabled={busy || !email || !password} onClick={() => { void action('signin'); }}>Sign in</button>{' '}
      <button type="button" disabled={busy || !email || !password} onClick={() => { void action('signup'); }}>Sign up</button>{' '}
      <button type="button" disabled={busy || !email} onClick={() => { void action('reset'); }}>Reset password</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

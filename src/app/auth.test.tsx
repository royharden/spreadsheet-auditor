// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from './auth.ts';
import { AuthPanel } from './components/AuthPanel.tsx';
import { FakeAuth, sessionA } from './testSupport.ts';
function Harness({ auth }: { auth: FakeAuth }) {
  const state = useAuth(auth);
  return <><p>{state.loading ? 'Restoring session' : 'Session restored'}</p><AuthPanel auth={auth} session={state.session} recovering={state.recovering} onRecovered={() => state.setRecovering(false)} /></>;
}
afterEach(() => cleanup());
describe('auth and recovery flow', () => {
  it('restores/subscribes, signs in/up/out, requests recovery and sets a new password', async () => {
    const auth = new FakeAuth(); const view = render(<Harness auth={auth} />);
    await screen.findByText('Session restored');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith({ email: 'a@example.test', password: 'test-password' }));
    await screen.findByText('Check your email for the next step.');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Signed in as a@example.test');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Email');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Reset password' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.test', { redirectTo: expect.stringContaining('?recovery=1') }));
    await screen.findByText('Check your email for the next step.');
    act(() => auth.emit('PASSWORD_RECOVERY', sessionA));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-test-password' }));
    await screen.findByText('Password updated.');
    view.unmount(); expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

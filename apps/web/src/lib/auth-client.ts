import { createAuthClient } from 'better-auth/react';

const authClient = createAuthClient();

interface AuthError {
  status: number;
  statusText: string;
  message?: string | undefined;
}

// Better Auth's client returns HTTP failures as { error } instead of throwing them.
function throwIfFailed(action: string, error: AuthError | null): void {
  if (error === null) return;
  const detail = error.message ?? `${error.status} ${error.statusText}`;
  throw new Error(`${action} failed: ${detail}`);
}

/** The current session, or null when signed out. Throws when the session check itself fails. */
export async function readSession() {
  const { data, error } = await authClient.getSession();
  throwIfFailed('Session check', error);
  return data;
}

/** Starts GitHub sign-in. On success, Better Auth sends the browser to GitHub. */
export async function signInWithGitHub(): Promise<void> {
  const { error } = await authClient.signIn.social({
    provider: 'github',
    callbackURL: '/',
    errorCallbackURL: '/sign-in',
  });
  throwIfFailed('GitHub sign-in', error);
}

export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  throwIfFailed('Sign out', error);
}

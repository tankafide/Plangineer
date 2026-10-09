import { useQuery } from '@tanstack/react-query';
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

/**
 * Starts GitHub sign-in. On success, Better Auth sends the browser to GitHub, and back to
 * `redirect` afterwards. A failure returns to sign-in with the same `redirect`.
 */
export async function signInWithGitHub(redirect: string): Promise<void> {
  const { error } = await authClient.signIn.social({
    provider: 'github',
    callbackURL: redirect,
    errorCallbackURL: `/sign-in?redirect=${encodeURIComponent(redirect)}`,
  });
  throwIfFailed('GitHub sign-in', error);
}

/**
 * The current session as a query, with the same loading, failed and retry states as a screen's
 * other reads. It lives in the query cache that sign-out clears, unlike Better Auth's page-wide
 * session store.
 */
export function useSession() {
  return useQuery({ queryKey: ['auth', 'session'], queryFn: readSession });
}

export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  throwIfFailed('Sign out', error);
}

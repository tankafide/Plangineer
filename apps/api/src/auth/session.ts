import type { InitialContext } from '../rpc/context.ts';
import type { AuthProvider } from './auth-provider.ts';

/** The signed-in user for a request's cookies, or null. */
export async function resolveSession(
  authProvider: AuthProvider,
  headers: Headers,
): Promise<InitialContext['session']> {
  const auth = await authProvider.get();
  const session = await auth.api.getSession({ headers });
  if (session === null) return null;
  const { id, name, email, role } = session.user;
  return { user: { id, name, email, role } };
}

import type { InitialContext } from '../rpc/context.ts';
import type { Auth } from './auth.ts';

/** The signed-in user for a request's cookies, or null. */
export async function resolveSession(
  auth: Auth,
  headers: Headers,
): Promise<InitialContext['session']> {
  const session = await auth.api.getSession({ headers });
  if (session === null) return null;
  const { id, name, email, role } = session.user;
  return { user: { id, name, email, role } };
}

// Free of Vitest, so the e2e CLIs can import it outside a test run.
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@plangineer/contracts';
import { makeSignature } from 'better-auth/crypto';
import type { Auth } from '../auth/auth.ts';

/**
 * Stores a user through Better Auth's own adapter, the way an admin would provision one. The
 * first-admin rule sets the role unless the overrides give one.
 */
export async function storeUser(
  auth: Auth,
  overrides: { name?: string; email?: string; role?: UserRole } = {},
) {
  const context = await auth.$context;
  const created = await context.internalAdapter.createUser(
    {
      name: overrides.name ?? 'Ada Lovelace',
      email: overrides.email ?? `ada-${randomUUID()}@example.com`,
      emailVerified: true,
    },
    { method: 'admin' },
  );
  if (overrides.role === undefined) return created;
  await context.internalAdapter.updateUser(created.id, { role: overrides.role });
  return { ...created, role: overrides.role };
}

/** The cookie header Better Auth issues for a new session of the user, signed with its secret. */
export async function sessionCookie(auth: Auth, userId: string): Promise<string> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const signature = await makeSignature(session.token, context.secret);
  return `${context.authCookies.sessionToken.name}=${session.token}.${signature}`;
}

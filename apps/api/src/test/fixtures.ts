import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { pino } from 'pino';
import { type Auth, createAuth } from '../auth/auth.ts';
import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';

export const GITHUB_CLIENT_ID = 'test-github-client-id';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: 'postgres://plangineer:plangineer@localhost:5432/plangineer',
    API_PORT: 3000,
    LOG_LEVEL: 'info',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
    BETTER_AUTH_URL: 'http://localhost:5173',
    GITHUB_APP_CLIENT_ID: GITHUB_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: 'test-github-client-secret',
    ...overrides,
  };
}

/** A logger that writes nothing, for tests that do not assert on logs. */
export const silentLogger = pino({ level: 'silent' });

export function testAuth(db: Database): Auth {
  return createAuth({ db, env: testEnv() });
}

/** Stores a user through Better Auth's own adapter, the way an admin would provision one. */
export async function storeUser(auth: Auth, overrides: { name?: string; email?: string } = {}) {
  const context = await auth.$context;
  return context.internalAdapter.createUser(
    {
      name: overrides.name ?? 'Ada Lovelace',
      email: overrides.email ?? `ada-${randomUUID()}@example.com`,
      emailVerified: true,
    },
    { method: 'admin' },
  );
}

/** The cookie header Better Auth issues for a new session of the user, signed with its secret. */
export async function sessionCookie(auth: Auth, userId: string): Promise<string> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const signature = await makeSignature(session.token, context.secret);
  return `${context.authCookies.sessionToken.name}=${session.token}.${signature}`;
}

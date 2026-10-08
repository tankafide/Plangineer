import { randomBytes, randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { pino } from 'pino';
import { type Auth, createAuth } from '../auth/auth.ts';
import type { Database } from '../db/client.ts';
import { runners } from '../db/schema.ts';
import { hashSecret } from '../runners/pairing.ts';
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
    RUNNER_HEARTBEAT_INTERVAL_MS: 10_000,
    RUN_LEASE_DURATION_MS: 30_000,
    RUNNER_OFFLINE_AFTER_MS: 30_000,
    RUN_SWEEP_INTERVAL_MS: 5_000,
    RUN_MAX_ATTEMPTS: 3,
    SSE_KEEPALIVE_INTERVAL_MS: 15_000,
    RUNNER_PAIRING_CODE_TTL_MS: 600_000,
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

/** The service dependencies for a test database, with a silent logger. */
export function testDeps(db: Database, overrides: Partial<Env> = {}) {
  return { db, env: testEnv(overrides), logger: silentLogger };
}

type RunnerRow = typeof runners.$inferInsert;

/**
 * Inserts a runner row directly with a random token hash, so run tests need no pairing. It is
 * online and has said hello unless the overrides say otherwise.
 */
export async function storeRunner(
  db: Database,
  overrides: Partial<RunnerRow> & { userId: string },
): Promise<string> {
  const [row] = await db
    .insert(runners)
    .values({
      name: 'workstation',
      platform: 'linux',
      tokenHash: randomBytes(32).toString('hex'),
      lastSeenAt: new Date(),
      concurrencyLimit: 2,
      ...overrides,
    })
    .returning({ id: runners.id });
  if (row === undefined) throw new Error('Runner insert returned no row');
  return row.id;
}

/** A runner row whose token is known, so a test can open its socket. */
export async function storeRunnerWithToken(
  db: Database,
  overrides: Partial<RunnerRow> & { userId: string },
): Promise<{ runnerId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const runnerId = await storeRunner(db, { ...overrides, tokenHash: hashSecret(token) });
  return { runnerId, token };
}

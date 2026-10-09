import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { inject } from 'vitest';
import { type Auth, createAuth } from '../auth/auth.ts';
import { type AuthProvider, createAuthProvider } from '../auth/auth-provider.ts';
import type { Database } from '../db/client.ts';
import { runners } from '../db/schema.ts';
import { hashSecret } from '../runners/pairing.ts';
import type { Env } from '../env.ts';
import { createGithub } from '../github/github.ts';
import { createGithubAppStore } from '../github/github-app-store.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { GITHUB_CLIENT_ID, TEST_AUTH_SECRET, testGithubApp } from './test-github-app.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    githubAppPrivateKey: string;
  }
}

export { GITHUB_CLIENT_ID };
export { sessionCookie, storeUser } from './users.ts';

/** The test App's PKCS#8 key, generated once per run by the global setup. */
export const TEST_APP_PRIVATE_KEY = inject('githubAppPrivateKey');

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: 'postgres://plangineer:plangineer@localhost:5432/plangineer',
    API_HOST: '127.0.0.1',
    API_PORT: 3000,
    API_LOG_FILE: path.join(os.tmpdir(), 'plangineer-api-test', 'api.log'),
    LOG_LEVEL: 'info',
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    SETUP_TOKEN: 'test-setup-token-that-is-at-least-32-characters',
    RUNNER_HEARTBEAT_INTERVAL_MS: 10_000,
    RUN_LEASE_DURATION_MS: 30_000,
    RUNNER_OFFLINE_AFTER_MS: 30_000,
    RUN_SWEEP_INTERVAL_MS: 5_000,
    RUN_MAX_ATTEMPTS: 3,
    SSE_KEEPALIVE_INTERVAL_MS: 15_000,
    RUNNER_LOGIN_TTL_MS: 600_000,
    ...overrides,
  };
}

/** A logger that writes nothing, for tests that do not assert on logs. */
export const silentLogger = pino({ level: 'silent' });

/** Better Auth for the test App every test database starts with. */
export function testAuth(db: Database): Auth {
  return createAuth({ db, env: testEnv(), githubApp: testGithubApp(TEST_APP_PRIVATE_KEY) });
}

/** The auth provider createApp takes, over the App stored in the test database. */
export function testAuthProvider(db: Database): AuthProvider {
  const env = testEnv();
  return createAuthProvider({
    db,
    env,
    appStore: createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET }),
  });
}

/**
 * The service dependencies for a test database, with a silent logger, the stored App and GitHub
 * behind MSW.
 */
export function testDeps(db: Database, overrides: Partial<Env> = {}): ServiceDeps {
  const env = testEnv(overrides);
  const appStore = createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET });
  return {
    db,
    env,
    logger: silentLogger,
    appStore,
    github: createGithub({ appStore, logger: silentLogger }),
  };
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

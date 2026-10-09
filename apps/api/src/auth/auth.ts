import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import { SEED_USER_IDS } from '../db/seed-ids.ts';
import type { Env } from '../env.ts';
import type { GithubAppCredentials } from '../github/github-app-store.ts';

/**
 * Whether an admin other than a seeded user exists. The first real user to sign in becomes the
 * admin, so a self-hosted deployment needs no promote step and the dev seed never blocks it.
 */
async function realAdminExists(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(eq(schema.user.role, 'admin'), notInArray(schema.user.id, Object.values(SEED_USER_IDS))),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Better Auth for the stored GitHub App. With no App there is no social provider, so a GitHub
 * sign-in fails with Better Auth's provider-not-found error until the App is created.
 */
export function createAuth({
  db,
  env,
  githubApp,
}: {
  db: Database;
  env: Env;
  githubApp: GithubAppCredentials | null;
}) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders:
      githubApp === null
        ? {}
        : { github: { clientId: githubApp.clientId, clientSecret: githubApp.clientSecret } },
    advanced: { database: { generateId: 'uuid' } },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => ({
            data: { ...newUser, role: (await realAdminExists(db)) ? 'member' : 'admin' },
          }),
        },
      },
    },
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        role: { type: 'string', input: false, defaultValue: 'member' },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

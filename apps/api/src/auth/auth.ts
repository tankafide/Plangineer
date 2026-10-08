import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import { SEED_USER_IDS } from '../db/seed-ids.ts';
import type { Env } from '../env.ts';

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

export function createAuth({ db, env }: { db: Database; env: Env }) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      github: {
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      },
    },
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

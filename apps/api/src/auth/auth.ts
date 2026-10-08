import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Database } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import type { Env } from '../env.ts';

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
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        role: { type: 'string', input: false, defaultValue: 'member' },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

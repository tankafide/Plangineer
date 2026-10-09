import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { Database } from '../db/client.ts';
import { githubApps } from '../db/schema.ts';

/** The deployment's GitHub App, with its client secret and PKCS#8 key in the clear. */
export interface GithubAppCredentials {
  appId: number;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  ownerLogin: string;
}

const UNDECRYPTABLE_MESSAGE =
  'The stored GitHub App cannot be decrypted. BETTER_AUTH_SECRET changed since the App was created.';

/**
 * The one stored GitHub App. get() caches the decrypted App, and reads the row again on every
 * call while nothing is cached, so an App another process inserts is seen without a restart.
 * Secrets are encrypted with `secret`, BETTER_AUTH_SECRET, as Better Auth encrypts OAuth tokens.
 */
export function createGithubAppStore({ db, secret }: { db: Database; secret: string }) {
  let cached: GithubAppCredentials | null = null;

  async function readStored(): Promise<GithubAppCredentials | null> {
    const [row] = await db
      .select({
        appId: githubApps.appId,
        slug: githubApps.slug,
        clientId: githubApps.clientId,
        clientSecretEncrypted: githubApps.clientSecretEncrypted,
        privateKeyEncrypted: githubApps.privateKeyEncrypted,
        ownerLogin: githubApps.ownerLogin,
      })
      .from(githubApps)
      .limit(1);
    if (row === undefined) return null;
    const { clientSecretEncrypted, privateKeyEncrypted, ...app } = row;
    try {
      return {
        ...app,
        clientSecret: await symmetricDecrypt({ key: secret, data: clientSecretEncrypted }),
        privateKey: await symmetricDecrypt({ key: secret, data: privateKeyEncrypted }),
      };
    } catch (error) {
      throw new Error(UNDECRYPTABLE_MESSAGE, { cause: error });
    }
  }

  return {
    async get(): Promise<GithubAppCredentials | null> {
      cached ??= await readStored();
      return cached;
    },

    /** Stores the App, or answers 'exists' when one is already stored. */
    async save(app: GithubAppCredentials): Promise<'saved' | 'exists'> {
      const { clientSecret, privateKey, ...rest } = app;
      const [row] = await db
        .insert(githubApps)
        .values({
          ...rest,
          clientSecretEncrypted: await symmetricEncrypt({ key: secret, data: clientSecret }),
          privateKeyEncrypted: await symmetricEncrypt({ key: secret, data: privateKey }),
        })
        .onConflictDoNothing({ target: githubApps.singleton })
        .returning({ id: githubApps.id });
      if (row === undefined) return 'exists';
      cached = app;
      return 'saved';
    },
  };
}

export type GithubAppStore = ReturnType<typeof createGithubAppStore>;

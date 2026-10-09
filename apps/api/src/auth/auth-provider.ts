import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';
import type { GithubAppCredentials, GithubAppStore } from '../github/github-app-store.ts';
import { type Auth, createAuth } from './auth.ts';

/**
 * The Better Auth instance for the stored GitHub App. It is rebuilt when the store returns
 * another App, so sign-in works as soon as the App is created, with no restart.
 */
export function createAuthProvider({
  db,
  env,
  appStore,
}: {
  db: Database;
  env: Env;
  appStore: GithubAppStore;
}) {
  let current: { githubApp: GithubAppCredentials | null; auth: Auth } | undefined;
  return {
    async get(): Promise<Auth> {
      const githubApp = await appStore.get();
      if (current === undefined || current.githubApp !== githubApp) {
        current = { githubApp, auth: createAuth({ db, env, githubApp }) };
      }
      return current.auth;
    },
  };
}

export type AuthProvider = ReturnType<typeof createAuthProvider>;

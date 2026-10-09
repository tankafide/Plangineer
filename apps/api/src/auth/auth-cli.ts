// Config for Better Auth's CLI only, which needs a module exporting a ready instance named auth.
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db/client.ts';
import { parseEnv } from '../env.ts';
import { createGithubAppStore } from '../github/github-app-store.ts';
import { createAuth } from './auth.ts';

process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
const env = parseEnv(process.env);

const { db } = createDatabase(env.DATABASE_URL);
const githubApp = await createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET }).get();

export const auth = createAuth({ db, env, githubApp });

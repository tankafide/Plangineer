// Config for Better Auth's CLI only, which needs a module exporting a ready instance named auth.
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db/client.ts';
import { parseEnv } from '../env.ts';
import { createAuth } from './auth.ts';

process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
const env = parseEnv(process.env);

export const auth = createAuth({ db: createDatabase(env.DATABASE_URL).db, env });

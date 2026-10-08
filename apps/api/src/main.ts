import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { createDatabase } from './db/client.ts';
import { type Env, parseEnv } from './env.ts';
import { createLogger } from './logger.ts';

function readEnv(): Env | undefined {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // LOG_LEVEL may be the invalid variable, so this logger uses a fixed level.
    createLogger('error').error({ err: error }, 'Invalid environment');
    return undefined;
  }
}

function start(env: Env): void {
  const logger = createLogger(env.LOG_LEVEL);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const app = createApp({ auth: createAuth({ db, env }), logger });

  const server = serve({ fetch: app.fetch, port: env.API_PORT }, ({ port }) => {
    logger.info({ port }, 'API listening');
  });

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'API shutting down');
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const env = readEnv();
if (env === undefined) process.exitCode = 1;
else start(env);

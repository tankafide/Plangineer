import { type Env, parseEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { startServer } from './server.ts';

function readEnv(): Env | undefined {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // LOG_LEVEL may be the invalid variable, so this logger uses a fixed level.
    createLogger('error').error({ err: error }, 'Invalid environment');
    return undefined;
  }
}

async function start(env: Env): Promise<void> {
  const logger = createLogger(env.LOG_LEVEL);
  const server = await startServer({ env, logger });
  logger.info({ port: server.port }, 'API listening');

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info({ signal }, 'API shutting down');
    await server.close();
    process.exit(0);
  }

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

const env = readEnv();
if (env === undefined) process.exitCode = 1;
else await start(env);

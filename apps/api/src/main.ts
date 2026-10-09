import { type Env, parseEnv } from './env.ts';
import { createLogger, type Logger } from './logger.ts';
import { type RunningServer, startServer } from './server.ts';

/**
 * Logs why the API cannot start and ends stderr with the reason, which the desktop app shows,
 * then sets a failed exit code.
 */
function failStart(logger: Logger, message: string, error: unknown): void {
  logger.fatal({ err: error }, message);
  logger.flush();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function readEnv(): Env | undefined {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // LOG_LEVEL or API_LOG_FILE may be the invalid variable, so this logger has a fixed level
    // and writes to stdout only.
    failStart(createLogger('error'), 'Invalid environment', error);
    return undefined;
  }
}

async function start(env: Env): Promise<void> {
  const logger = createLogger(env.LOG_LEVEL, env.API_LOG_FILE);
  let server: RunningServer;
  try {
    server = await startServer({ env, logger });
  } catch (error) {
    failStart(logger, 'API failed to start', error);
    return;
  }
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
if (env !== undefined) await start(env);

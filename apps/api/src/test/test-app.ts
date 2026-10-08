import { createApp } from '../app.ts';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';
import { createNotificationListener } from '../realtime/notifications.ts';
import { createRunnerConnections } from '../runners/runner-connections.ts';
import { createRunEventTail } from '../runs/run-event-tail.ts';
import { startServer } from '../server.ts';
import { silentLogger, testAuth, testDeps, testEnv } from './fixtures.ts';
import type { TestDatabase } from './test-database.ts';

/** The Hono app on a test database, with its real listener, runner connections and tail. */
export async function createTestApp(database: TestDatabase, overrides: Partial<Env> = {}) {
  const deps = testDeps(database.db, { DATABASE_URL: database.url, ...overrides });
  const listener = await createNotificationListener({
    databaseUrl: database.url,
    logger: silentLogger,
  });
  const realtime = {
    connections: createRunnerConnections({ deps, listener }),
    tail: createRunEventTail({ deps, listener }),
  };
  const auth = testAuth(database.db);
  return {
    app: createApp({ auth, deps, realtime }),
    auth,
    close: async () => {
      await realtime.connections.close();
      realtime.tail.close();
      await listener.close();
    },
  };
}

/** A real API server on a free port, on the test database. */
export function startTestServer(
  database: TestDatabase,
  overrides: Partial<Env> = {},
  logger: Logger = silentLogger,
) {
  return startServer({
    env: testEnv({ DATABASE_URL: database.url, API_PORT: 0, ...overrides }),
    logger,
  });
}

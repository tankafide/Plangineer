import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuthProvider } from './auth/auth-provider.ts';
import { createDatabase } from './db/client.ts';
import type { Env } from './env.ts';
import { createGithub } from './github/github.ts';
import { createGithubAppStore } from './github/github-app-store.ts';
import type { Logger } from './logger.ts';
import { createNotificationListener } from './realtime/notifications.ts';
import { createRunnerConnections } from './runners/runner-connections.ts';
import { createRunnerSocketServer } from './runners/runner-socket.ts';
import { createRunEventTail } from './runs/run-event-tail.ts';

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Starts the API on env.API_HOST and env.API_PORT, where port 0 picks a free port. A stored GitHub
 * App that does not decrypt stops the start. close() stops the sweeper, closes runner sockets
 * with 1001, ends SSE streams, then closes the HTTP server, the listener and the pool, in that
 * order.
 */
export async function startServer({
  env,
  logger,
}: {
  env: Env;
  logger: Logger;
}): Promise<RunningServer> {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const appStore = createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET });
  try {
    await appStore.get();
  } catch (error) {
    await pool.end();
    throw error;
  }
  const listener = await createNotificationListener({ databaseUrl: env.DATABASE_URL, logger });
  const github = createGithub({ appStore, logger });
  const deps = { db, env, logger, github, appStore };
  const realtime = {
    connections: createRunnerConnections({ deps, listener }),
    tail: createRunEventTail({ deps, listener }),
  };
  const authProvider = createAuthProvider({ db, env, appStore });
  const app = createApp({ authProvider, deps, realtime });

  const listening = Promise.withResolvers<AddressInfo>();
  const server = serve(
    {
      fetch: app.fetch,
      hostname: env.API_HOST,
      port: env.API_PORT,
      websocket: { server: createRunnerSocketServer() },
    },
    listening.resolve,
  );
  server.once('error', listening.reject);
  let port: number;
  try {
    ({ port } = await listening.promise);
  } catch (error) {
    // Close what started, so a port in use ends the process with its reason instead of hanging.
    await realtime.connections.close();
    realtime.tail.close();
    await listener.close();
    await pool.end();
    throw error;
  }

  return {
    port,
    async close() {
      await realtime.connections.close();
      realtime.tail.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
      await listener.close();
      await pool.end();
    },
  };
}

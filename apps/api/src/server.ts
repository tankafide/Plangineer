import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { createDatabase } from './db/client.ts';
import type { Env } from './env.ts';
import { createGithub } from './github/github.ts';
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
 * Starts the API on env.API_PORT, where 0 picks a free port. close() stops the sweeper,
 * closes runner sockets with 1001, ends SSE streams, then closes the HTTP server, the
 * listener and the pool, in that order.
 */
export async function startServer({
  env,
  logger,
}: {
  env: Env;
  logger: Logger;
}): Promise<RunningServer> {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const listener = await createNotificationListener({ databaseUrl: env.DATABASE_URL, logger });
  const github = createGithub(env, logger);
  const deps = { db, env, logger, github };
  const realtime = {
    connections: createRunnerConnections({ deps, listener }),
    tail: createRunEventTail({ deps, listener }),
  };
  const app = createApp({ auth: createAuth({ db, env }), deps, realtime });

  const listening = Promise.withResolvers<AddressInfo>();
  const server = serve(
    { fetch: app.fetch, port: env.API_PORT, websocket: { server: createRunnerSocketServer() } },
    listening.resolve,
  );
  server.once('error', listening.reject);
  const { port } = await listening.promise;

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

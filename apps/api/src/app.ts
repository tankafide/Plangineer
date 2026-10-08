import { onError, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { SimpleCsrfProtectionHandlerPlugin } from '@orpc/server/plugins';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { RUN_EVENTS_PATH } from '@plangineer/contracts';
import type { Auth } from './auth/auth.ts';
import { resolveSession } from './auth/session.ts';
import type { Database } from './db/client.ts';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';
import { router } from './rpc/router.ts';
import type { RunnerConnections } from './runners/runner-connections.ts';
import { RUNNER_SOCKET_PATH, runnerSocketRoute } from './runners/runner-socket.ts';
import { runEventStreamRoute } from './runs/run-event-stream.ts';
import type { RunEventTail } from './runs/run-event-tail.ts';

const MAX_BODY_BYTES = 1024 * 1024;

type AppEnv = { Variables: { requestId: string; logger: Logger } };

/** The parts that serve live runs: the runner sockets and the run event tail. */
export interface Realtime {
  connections: RunnerConnections;
  tail: RunEventTail;
}

export function createApp({
  auth,
  logger,
  db,
  env,
  realtime,
}: {
  auth: Auth;
  logger: Logger;
  db: Database;
  env: Env;
  realtime: Realtime;
}) {
  const rpcHandler = new RPCHandler(router, {
    plugins: [new SimpleCsrfProtectionHandlerPlugin()],
    interceptors: [
      onError((error, { context }) => {
        // A 4xx ORPCError is an expected answer, such as UNAUTHORIZED; only the rest are failures.
        if (error instanceof ORPCError && error.status < 500) {
          context.logger.debug({ code: error.code, status: error.status }, 'RPC procedure refused');
          return;
        }
        context.logger.error({ err: error }, 'RPC procedure failed');
      }),
    ],
  });

  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    c.set('logger', logger.child({ requestId: c.get('requestId') }));
    await next();
  });
  for (const path of ['/api/*', '/rpc/*']) {
    app.use(path, bodyLimit({ maxSize: MAX_BODY_BYTES }));
  }

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.get(RUNNER_SOCKET_PATH, (c, next) =>
    runnerSocketRoute({ db, env, logger: c.get('logger') }, realtime.connections)(c, next),
  );
  app.get(RUN_EVENTS_PATH, (c) =>
    runEventStreamRoute({ deps: { db, env, logger: c.get('logger') }, auth, tail: realtime.tail })(
      c,
    ),
  );

  app.use('/rpc/*', async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/rpc',
      context: {
        logger: c.get('logger'),
        db,
        env,
        session: await resolveSession(auth, c.req.raw.headers),
      },
    });
    if (matched) return c.newResponse(response.body, response);
    return next();
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    c.get('logger').error({ err: error }, 'Request failed');
    return c.text('Internal Server Error', 500);
  });

  return app;
}

import { onError, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { SimpleCsrfProtectionHandlerPlugin } from '@orpc/server/plugins';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { RUN_EVENTS_PATH, RUNNER_ATTACHMENT_PATH } from '@plangineer/contracts';
import type { AuthProvider } from './auth/auth-provider.ts';
import { resolveSession } from './auth/session.ts';
import type { ServiceDeps } from './lib/service-deps.ts';
import type { Logger } from './logger.ts';
import { router } from './rpc/router.ts';
import { runnerAttachmentRoute } from './runners/runner-attachment-route.ts';
import type { RunnerConnections } from './runners/runner-connections.ts';
import { RUNNER_SOCKET_PATH, runnerSocketRoute } from './runners/runner-socket.ts';
import { runEventStreamRoute } from './runs/run-event-stream.ts';
import type { RunEventTail } from './runs/run-event-tail.ts';
import { registerWebAssets } from './web-assets.ts';

const MAX_BODY_BYTES = 1024 * 1024;
/** feature.create carries up to 25 MiB of attachments, so its path alone takes 26 MiB. */
const FEATURE_CREATE_PATH = '/rpc/feature/create';
const FEATURE_CREATE_MAX_BODY_BYTES = 26 * 1024 * 1024;

type AppEnv = { Variables: { requestId: string; logger: Logger } };

/** The parts that serve live runs: the runner sockets and the run event tail. */
export interface Realtime {
  connections: RunnerConnections;
  tail: RunEventTail;
}

export function createApp({
  authProvider,
  deps,
  realtime,
}: {
  authProvider: AuthProvider;
  deps: ServiceDeps;
  realtime: Realtime;
}) {
  const { logger } = deps;
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
  const defaultBodyLimit = bodyLimit({ maxSize: MAX_BODY_BYTES });
  const featureCreateBodyLimit = bodyLimit({ maxSize: FEATURE_CREATE_MAX_BODY_BYTES });
  app.use('/api/*', defaultBodyLimit);
  app.use('/rpc/*', (c, next) =>
    (c.req.path === FEATURE_CREATE_PATH ? featureCreateBodyLimit : defaultBodyLimit)(c, next),
  );

  app.on(['GET', 'POST'], '/api/auth/*', async (c) =>
    (await authProvider.get()).handler(c.req.raw),
  );

  app.get(RUNNER_SOCKET_PATH, (c, next) =>
    runnerSocketRoute({ ...deps, logger: c.get('logger') }, realtime.connections)(c, next),
  );
  app.get(RUNNER_ATTACHMENT_PATH, (c) =>
    runnerAttachmentRoute({ ...deps, logger: c.get('logger') })(c),
  );
  app.get(RUN_EVENTS_PATH, (c) =>
    runEventStreamRoute({
      deps: { ...deps, logger: c.get('logger') },
      authProvider,
      tail: realtime.tail,
    })(c),
  );

  app.use('/rpc/*', async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/rpc',
      context: {
        ...deps,
        logger: c.get('logger'),
        session: await resolveSession(authProvider, c.req.raw.headers),
      },
    });
    if (matched) return c.newResponse(response.body, response);
    return next();
  });

  if (deps.env.WEB_DIST_DIR !== undefined) registerWebAssets(app, deps.env.WEB_DIST_DIR);

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    c.get('logger').error({ err: error }, 'Request failed');
    return c.text('Internal Server Error', 500);
  });

  return app;
}

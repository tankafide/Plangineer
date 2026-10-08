import {
  isTerminalRunEvent,
  type RunEvent,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from '@plangineer/contracts';
import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import type { Auth } from '../auth/auth.ts';
import { resolveSession } from '../auth/session.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { type RunEventTail, RUN_EVENTS_PAGE_SIZE } from './run-event-tail.ts';
import { readRunEvents } from './run-events-repository.ts';
import { getRun } from './run-service.ts';

const SSE_EVENT = 'run-event';

/**
 * Streams one run's events to its owner: the stored events after Last-Event-ID, then live
 * ones from the tail, each with its event id. The stream ends after the terminal event.
 */
async function streamRunEvents(
  {
    deps,
    tail,
    runId,
    afterEventId,
    endedBefore,
  }: {
    deps: ServiceDeps;
    tail: RunEventTail;
    runId: string;
    afterEventId: number;
    /** The run was terminal before the backlog read, so the backlog holds its last event. */
    endedBefore: boolean;
  },
  stream: SSEStreamingApi,
): Promise<void> {
  let lastSent = afterEventId;
  let failure: unknown;
  const finished = Promise.withResolvers<void>();
  let ended = false;
  const isEnded = () => ended;
  const end = () => {
    ended = true;
    finished.resolve();
  };

  async function send(events: RunEvent[]): Promise<void> {
    for (const event of events) {
      if (ended || event.id <= lastSent) continue;
      await stream.writeSSE({
        id: String(event.id),
        event: SSE_EVENT,
        data: JSON.stringify(event),
      });
      lastSent = event.id;
      if (isTerminalRunEvent(event)) end();
    }
  }

  // Live events wait behind the backlog, so nothing is sent out of order.
  const backlogSent = Promise.withResolvers<void>();
  let writes = backlogSent.promise;
  const enqueue = (write: () => Promise<void>) => {
    writes = writes.then(write).catch((error: unknown) => {
      failure = error;
      end();
    });
  };

  stream.onAbort(end);
  const unsubscribe = await tail.subscribe(runId, {
    deliver: (events) => enqueue(() => send(events)),
    end,
  });
  const keepalive = setInterval(
    () => enqueue(() => stream.write(': keepalive\n\n').then(() => undefined)),
    deps.env.SSE_KEEPALIVE_INTERVAL_MS,
  );
  try {
    let page: RunEvent[];
    do {
      page = await readRunEvents(deps.db, runId, lastSent, RUN_EVENTS_PAGE_SIZE);
      await send(page);
    } while (!isEnded() && page.length === RUN_EVENTS_PAGE_SIZE);
    // A client resuming past the terminal event gets no terminal event to end on.
    if (endedBefore) end();
    backlogSent.resolve();
    await finished.promise;
    await writes;
  } finally {
    clearInterval(keepalive);
    unsubscribe();
  }
  if (failure !== undefined) throw failure;
}

/** GET RUN_EVENTS_PATH: 401 without a session, 404 for a run the caller does not own. */
export function runEventStreamRoute({
  deps,
  auth,
  tail,
}: {
  deps: ServiceDeps;
  auth: Auth;
  tail: RunEventTail;
}) {
  return async (c: Context) => {
    const session = await resolveSession(auth, c.req.raw.headers);
    if (session === null) return c.text('Unauthorized', 401);
    const lastEventId = c.req.header('last-event-id');
    if (lastEventId !== undefined && !/^\d+$/.test(lastEventId)) {
      return c.text('Last-Event-ID must be a non-negative integer', 400);
    }
    const runId = c.req.param('runId') ?? '';
    const run = z.uuid().safeParse(runId).success
      ? await getRun(deps, session.user.id, runId)
      : undefined;
    if (run === undefined || !run.ok) return c.text('Not Found', 404);

    const logger = deps.logger.child({ runId });
    return streamSSE(
      c,
      async (stream) => {
        try {
          await streamRunEvents(
            {
              deps,
              tail,
              runId,
              afterEventId: Number(lastEventId ?? 0),
              endedBefore: (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(
                run.value.status,
              ),
            },
            stream,
          );
        } catch (error) {
          // streamSSE sends the message to the client, so it carries nothing internal.
          throw new Error('The run event stream failed', { cause: error });
        }
      },
      async (error) => {
        logger.error({ err: error.cause }, 'Run event stream failed');
      },
    );
  };
}

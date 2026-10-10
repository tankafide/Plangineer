import { generateOperationKey } from '@orpc/tanstack-query';
import { isTerminalRunEvent, type RunEvent, runEventsPath } from '@plangineer/contracts';
import {
  queryOptions,
  type SkipToken,
  skipToken,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApiRoute, useApiUtils } from './api-provider.tsx';
import { patchRunWithEvent } from './run-event-patch.ts';
import { followRunEvents, type RunEventStreamState } from './run-event-stream.ts';

const NO_EVENTS: readonly RunEvent[] = [];

/**
 * The applied events of one run's stream. Only the stream writes them, so nothing fetches. A
 * skipped stream's key carries skipToken as its input, as oRPC's own skipped queries do.
 */
function runEventsQuery(runId: string | SkipToken) {
  return queryOptions<readonly RunEvent[]>({
    queryKey: generateOperationKey(['run', 'events'], {
      type: 'query',
      input: runId === skipToken ? skipToken : { runId },
    }),
    queryFn: skipToken,
    staleTime: Infinity,
  });
}

/** Appends an event unless it is at or below the last applied id, so a replay changes nothing. */
function applyRunEvent(events: readonly RunEvent[], event: RunEvent): readonly RunEvent[] {
  const last = events.at(-1);
  return last !== undefined && event.id <= last.id ? events : [...events, event];
}

function isEnded(events: readonly RunEvent[]): boolean {
  const last = events.at(-1);
  return last !== undefined && isTerminalRunEvent(last);
}

function initialState(runId: string | SkipToken): RunEventStreamState {
  return { status: runId === skipToken ? 'idle' : 'connecting' };
}

interface Connection {
  runId: string | SkipToken;
  /** Bumped by retry, so the effect opens a fresh stream. */
  attempt: number;
  state: RunEventStreamState;
}

/**
 * Follows a run's events over SSE. Events stay in the query cache, so a remount resumes from the
 * last applied id, and lifecycle events keep the run's cached details current. With skipToken it
 * opens no stream and reports `idle`.
 */
export function useRunEvents(runId: string | SkipToken) {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  const resolveRoute = useApiRoute();
  const url = runId === skipToken ? null : resolveRoute(runEventsPath(runId));
  // The log is empty until the stream applies its first event.
  const events = useQuery(runEventsQuery(runId)).data ?? NO_EVENTS;
  const [connection, setConnection] = useState<Connection>({
    runId,
    attempt: 0,
    state: initialState(runId),
  });
  const current: Connection =
    connection.runId === runId ? connection : { runId, attempt: 0, state: initialState(runId) };
  const state: RunEventStreamState = isEnded(events) ? { status: 'ended' } : current.state;

  useEffect(() => {
    const controller = new AbortController();
    if (runId === skipToken || url === null) return () => controller.abort();
    const eventsKey = runEventsQuery(runId).queryKey;
    const runKey = utils.run.get.queryKey({ input: { runId } });
    const readEvents = () => queryClient.getQueryData(eventsKey) ?? NO_EVENTS;
    const onEvent = (event: RunEvent) => {
      const before = readEvents();
      const after = applyRunEvent(before, event);
      if (after === before) return;
      queryClient.setQueryData(eventsKey, after);
      queryClient.setQueryData(runKey, (run) => run && patchRunWithEvent(run, event));
      if (isTerminalRunEvent(event)) void queryClient.invalidateQueries({ queryKey: runKey });
    };
    if (!isEnded(readEvents())) {
      void followRunEvents({
        url,
        signal: controller.signal,
        lastEventId: () => readEvents().at(-1)?.id ?? 0,
        onState: (next) => setConnection({ runId, attempt: current.attempt, state: next }),
        onEvent,
      });
    }
    return () => controller.abort();
  }, [runId, url, utils, queryClient, current.attempt]);

  const retry = () =>
    setConnection({ runId, attempt: current.attempt + 1, state: initialState(runId) });

  return { events, state, retry };
}

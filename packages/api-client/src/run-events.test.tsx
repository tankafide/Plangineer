import { runEventsPath, type RunEvent } from '@plangineer/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunEvents } from './run-events.ts';
import { useRun } from './runs.ts';
import {
  COMMIT,
  droppableSseResponse,
  messageEvent,
  RUN_ID,
  runFixture,
  RUNNER_ID,
  sseMessage,
  sseResponse,
  succeededEvent,
} from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

const EVENTS_URL = new URL(runEventsPath(RUN_ID), RPC_URL).href;

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers the stream with one response per request, recording each Last-Event-ID header. */
function answerStream(...responses: Array<() => Response | Promise<Response>>) {
  const lastEventIds: Array<string | null> = [];
  server.use(
    http.get(EVENTS_URL, ({ request }) => {
      lastEventIds.push(request.headers.get('last-event-id'));
      const respond = responses[lastEventIds.length - 1];
      if (respond === undefined) throw new Error(`No response for request ${lastEventIds.length}`);
      return respond();
    }),
  );
  return lastEventIds;
}

function answerRunGet(...runs: Array<ReturnType<typeof runFixture>>) {
  const calls = { count: 0 };
  server.use(
    http.post(`${RPC_URL}/run/get`, () => {
      const run = runs[Math.min(calls.count, runs.length - 1)];
      calls.count += 1;
      return HttpResponse.json(rpcBody(run));
    }),
  );
  return calls;
}

const ids = (events: readonly RunEvent[]) => events.map((event) => event.id);
const messages = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => sseMessage(messageEvent(from + index)));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useRunEvents', () => {
  it('reconnects after the stream ends early with Last-Event-ID: 5 and applies no event twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const lastEventIds = answerStream(
      () => sseResponse(messages(1, 5), 'close'),
      () => sseResponse([...messages(4, 7), sseMessage(succeededEvent(8))], 'close'),
    );
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await vi.waitFor(() => expect(result.current.state.status).toBe('reconnecting'));
    expect(ids(result.current.events)).toEqual([1, 2, 3, 4, 5]);

    await act(() => vi.advanceTimersByTimeAsync(1_500));

    await vi.waitFor(() => expect(result.current.state.status).toBe('ended'));
    expect(lastEventIds).toEqual(['0', '5']);
    expect(ids(result.current.events)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reconnects after a network drop, only once the backoff has passed', async () => {
    const first = droppableSseResponse(messages(1, 2));
    const lastEventIds = answerStream(
      () => first.response,
      () => sseResponse(messages(3, 3), 'open'),
    );
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await waitFor(() => expect(ids(result.current.events)).toEqual([1, 2]));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await act(() => first.drop());

    await vi.waitFor(() => expect(result.current.state.status).toBe('reconnecting'), {
      interval: 1,
    });
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(lastEventIds).toEqual(['0']);
    await act(() => vi.advanceTimersByTimeAsync(600));
    await vi.waitFor(() => expect(result.current.state.status).toBe('live'), { interval: 1 });
    expect(lastEventIds).toEqual(['0', '2']);
    expect(ids(result.current.events)).toEqual([1, 2, 3]);
  });

  it('reconnects at once when the page becomes visible again', async () => {
    const lastEventIds = answerStream(
      () => sseResponse(messages(1, 2), 'close'),
      () => sseResponse(messages(3, 3), 'open'),
    );
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await waitFor(() => expect(result.current.state.status).toBe('reconnecting'));

    act(() => setVisibility('visible'));

    await waitFor(() => expect(ids(result.current.events)).toEqual([1, 2, 3]));
    expect(result.current.state.status).toBe('live');
    expect(lastEventIds).toEqual(['0', '2']);
  });

  it('parses an event split across chunks and CRLF line endings', async () => {
    const split = sseMessage(messageEvent(1, 'Split in two'));
    const crlf = sseMessage(messageEvent(2, 'Ends in CRLF'), '\r\n');
    answerStream(() => sseResponse([split.slice(0, 30), split.slice(30), crlf], 'open'));
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });

    await waitFor(() => expect(ids(result.current.events)).toEqual([1, 2]));
    expect(
      result.current.events.map((event) => event.type === 'agent.message' && event.text),
    ).toEqual(['Split in two', 'Ends in CRLF']);
    expect(result.current.state.status).toBe('live');
  });

  it('resumes from the cached last event id after a remount', async () => {
    const lastEventIds = answerStream(
      () => sseResponse(messages(1, 3), 'open'),
      () => sseResponse(messages(4, 4), 'open'),
    );
    const queryClient = newQueryClient();
    const first = renderHook(() => useRunEvents(RUN_ID), { wrapper: apiWrapper(queryClient) });
    await waitFor(() => expect(ids(first.result.current.events)).toEqual([1, 2, 3]));
    first.unmount();

    const second = renderHook(() => useRunEvents(RUN_ID), { wrapper: apiWrapper(queryClient) });

    await waitFor(() => expect(ids(second.result.current.events)).toEqual([1, 2, 3, 4]));
    expect(lastEventIds).toEqual(['0', '3']);
  });

  it('reports failed on a 404 without reconnecting', async () => {
    const lastEventIds = answerStream(
      () => new HttpResponse(null, { status: 404 }),
      () => sseResponse([], 'open'),
    );
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
    act(() => setVisibility('visible'));
    expect(lastEventIds).toEqual(['0']);
  });

  it('reports failed on an event that does not parse, without skipping it', async () => {
    const invalid = 'id: 2\nevent: run-event\ndata: {"id":2,"type":"agent.message"}\n\n';
    answerStream(() => sseResponse([...messages(1, 1), invalid, ...messages(3, 3)], 'open'));
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
    expect(ids(result.current.events)).toEqual([1]);
  });

  it('retries a failed stream from the last applied id', async () => {
    const lastEventIds = answerStream(
      () => sseResponse(messages(1, 1), 'open'),
      () => new HttpResponse(null, { status: 404 }),
      () => sseResponse(messages(2, 2), 'open'),
    );
    const { result } = renderHook(() => useRunEvents(RUN_ID), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await waitFor(() => expect(ids(result.current.events)).toEqual([1]));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('failed'));

    act(() => result.current.retry());

    await waitFor(() => expect(ids(result.current.events)).toEqual([1, 2]));
    expect(lastEventIds).toEqual(['0', '1', '1']);
  });

  it('ends after a terminal event and refetches the run details', async () => {
    const runGets = answerRunGet(
      runFixture({ status: 'running' }),
      runFixture({ status: 'succeeded' }),
    );
    const runLoaded = Promise.withResolvers<void>();
    const lastEventIds = answerStream(async () => {
      await runLoaded.promise;
      return sseResponse([sseMessage(succeededEvent(1)), ...messages(2, 2)], 'open');
    });
    const { result } = renderHook(() => ({ stream: useRunEvents(RUN_ID), run: useRun(RUN_ID) }), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await waitFor(() => expect(result.current.run.data?.status).toBe('running'));

    runLoaded.resolve();

    await waitFor(() => expect(result.current.stream.state.status).toBe('ended'));
    await waitFor(() => expect(result.current.run.data?.status).toBe('succeeded'));
    expect(runGets.count).toBe(2);
    expect(ids(result.current.stream.events)).toEqual([1]);
    act(() => setVisibility('visible'));
    expect(lastEventIds).toEqual(['0']);
  });

  it('patches the cached run from lifecycle events without a refetch', async () => {
    const runGets = answerRunGet(runFixture({ status: 'queued', attempt: 0 }));
    const leased: RunEvent = {
      id: 1,
      runId: RUN_ID,
      at: '2026-10-07T10:00:01.000Z',
      type: 'run.leased',
      runnerId: RUNNER_ID,
      attempt: 1,
    };
    const started: RunEvent = {
      id: 2,
      runId: RUN_ID,
      at: '2026-10-07T10:00:02.000Z',
      type: 'run.started',
      commit: COMMIT,
      cli: { name: 'claude-code', version: '2.1.284' },
    };
    const runLoaded = Promise.withResolvers<void>();
    answerStream(async () => {
      await runLoaded.promise;
      return sseResponse([sseMessage(leased), sseMessage(started)], 'open');
    });
    const { result } = renderHook(() => ({ stream: useRunEvents(RUN_ID), run: useRun(RUN_ID) }), {
      wrapper: apiWrapper(newQueryClient()),
    });
    await waitFor(() => expect(result.current.run.isSuccess).toBe(true));

    runLoaded.resolve();

    await waitFor(() => expect(result.current.run.data?.status).toBe('running'));
    expect(result.current.run.data).toMatchObject({
      attempt: 1,
      commit: COMMIT,
      startedAt: '2026-10-07T10:00:02.000Z',
    });
    expect(runGets.count).toBe(1);
  });
});

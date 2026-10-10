import { runEventsPath } from '@plangineer/contracts';
import { act, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useFeature } from './features.ts';
import {
  planConflictReason,
  useContinuePlanning,
  usePlan,
  usePlanRevision,
  usePlanTurnEvents,
  useRetryTurn,
} from './plan.ts';
import {
  FEATURE_ID,
  featureFixture,
  messageEvent,
  planRevisionFixture,
  planWorkspaceFixture,
  RUN_ID,
  sseMessage,
  sseResponse,
  succeededEvent,
} from './test-fixtures.ts';
import {
  answerProcedure,
  newQueryClient,
  renderHooks,
  RPC_URL,
  rpcBody,
  rpcConflict,
  server,
} from './test-utils.tsx';

const EVENTS_URL = new URL(runEventsPath(RUN_ID), RPC_URL).href;

const runningWorkspace = (status: 'queued' | 'leased' | 'running' | 'succeeded') => {
  const { turn } = planWorkspaceFixture();
  if (turn === null) throw new Error('The workspace fixture has no turn');
  return planWorkspaceFixture({ revision: null, turn: { ...turn, status } });
};

describe('usePlan', () => {
  it('reads plan.get under the plan.get key for the feature id', async () => {
    const inputs = answerProcedure('plan/get', planWorkspaceFixture());

    const { result, queryClient } = renderHooks(() => usePlan(FEATURE_ID));

    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));
    expect(inputs).toEqual([{ featureId: FEATURE_ID }]);
    const key = result.current.utils.plan.get.queryKey({ input: { featureId: FEATURE_ID } });
    expect(queryClient.getQueryData(key)).toEqual(planWorkspaceFixture());
  });
});

describe('usePlanTurnEvents', () => {
  it("opens the running turn's stream and refetches the workspace and feature when it ends", async () => {
    const plans = answerProcedure('plan/get', runningWorkspace('running'), planWorkspaceFixture());
    const features = answerProcedure('feature/get', featureFixture({ state: 'planning' }));
    const streamOpened = Promise.withResolvers<void>();
    const turnDone = Promise.withResolvers<void>();
    const lastEventIds: Array<string | null> = [];
    server.use(
      http.get(EVENTS_URL, async ({ request }) => {
        lastEventIds.push(request.headers.get('last-event-id'));
        streamOpened.resolve();
        await turnDone.promise;
        return sseResponse([sseMessage(messageEvent(1)), sseMessage(succeededEvent(2))], 'open');
      }),
    );
    const { result } = renderHooks(() => {
      const plan = usePlan(FEATURE_ID);
      return { plan, feature: useFeature(FEATURE_ID), turn: usePlanTurnEvents(plan.data) };
    });
    await streamOpened.promise;
    await waitFor(() => expect(result.current.hooks.feature.isSuccess).toBe(true));
    expect(plans).toHaveLength(1);

    turnDone.resolve();

    await waitFor(() => expect(result.current.hooks.plan.data?.revision?.number).toBe(1));
    expect(plans).toHaveLength(2);
    expect(features).toHaveLength(2);
    expect(lastEventIds).toEqual(['0']);
    expect(result.current.hooks.turn.state.status).toBe('idle');
  });

  it.each(['queued', 'leased'] as const)('opens the stream of a %s turn', async (status) => {
    answerProcedure('plan/get', runningWorkspace(status));
    const opened = Promise.withResolvers<void>();
    server.use(
      http.get(EVENTS_URL, () => {
        opened.resolve();
        return sseResponse([sseMessage(messageEvent(1))], 'open');
      }),
    );
    const { result } = renderHooks(() => usePlanTurnEvents(usePlan(FEATURE_ID).data));

    await opened.promise;

    await waitFor(() => expect(result.current.hooks.state.status).toBe('live'));
  });

  it('opens no stream for a turn that has ended', async () => {
    answerProcedure('plan/get', runningWorkspace('succeeded'));
    const requests: string[] = [];
    server.use(
      http.get(EVENTS_URL, ({ request }) => {
        requests.push(request.url);
        return sseResponse([], 'open');
      }),
    );
    const { result } = renderHooks(() => {
      const plan = usePlan(FEATURE_ID);
      return { plan, turn: usePlanTurnEvents(plan.data) };
    });

    await waitFor(() => expect(result.current.hooks.plan.isSuccess).toBe(true));
    await delay(20);
    expect(result.current.hooks.turn.state.status).toBe('idle');
    expect(result.current.hooks.turn.events).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('usePlanRevision', () => {
  it('reads a revision once and serves it from the cache after a remount', async () => {
    const inputs = answerProcedure('plan/revision', planRevisionFixture({ number: 2 }));
    const queryClient = newQueryClient();
    const first = renderHooks(() => usePlanRevision(FEATURE_ID, 2), queryClient);
    await waitFor(() => expect(first.result.current.hooks.data?.number).toBe(2));
    first.unmount();

    const second = renderHooks(() => usePlanRevision(FEATURE_ID, 2), queryClient);

    expect(second.result.current.hooks.data?.number).toBe(2);
    await delay(20);
    expect(inputs).toEqual([{ featureId: FEATURE_ID, number: 2 }]);
  });

  it('sends nothing while the number is undefined', async () => {
    const inputs = answerProcedure('plan/revision', planRevisionFixture());

    const { result } = renderHooks(() => usePlanRevision(FEATURE_ID, undefined));

    await delay(20);
    expect(result.current.hooks.isPending).toBe(true);
    expect(inputs).toEqual([]);
  });
});

describe('planConflictReason', () => {
  it('returns the reason of a CONFLICT and null for another error', async () => {
    server.use(
      http.post(`${RPC_URL}/plan/continue`, () => rpcConflict('questions_open')),
      http.post(`${RPC_URL}/plan/retry`, () =>
        HttpResponse.json(
          rpcBody({ defined: true, code: 'RUNNER_REQUIRED', status: 409, message: 'No runner' }),
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHooks(() => ({ go: useContinuePlanning(), retry: useRetryTurn() }));

    act(() => {
      result.current.hooks.go.mutate({ featureId: FEATURE_ID });
      result.current.hooks.retry.mutate({ featureId: FEATURE_ID });
    });

    await waitFor(() => expect(result.current.hooks.go.isError).toBe(true));
    await waitFor(() => expect(result.current.hooks.retry.isError).toBe(true));
    expect(planConflictReason(result.current.hooks.go.error)).toBe('questions_open');
    expect(planConflictReason(result.current.hooks.retry.error)).toBeNull();
  });
});

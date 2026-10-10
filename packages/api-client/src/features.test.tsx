import type { FeatureDetail, FeatureSummary } from '@plangineer/contracts';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startPlanningConflictReason,
  useCreateFeature,
  useFeature,
  useFeatureList,
  useStartPlanning,
  useUpdateFeature,
} from './features.ts';
import {
  FEATURE_ID,
  featureFixture,
  planWorkspaceFixture,
  REPOSITORY_ID,
} from './test-fixtures.ts';
import { answerProcedure, renderHooks, RPC_URL, rpcBody, server } from './test-utils.tsx';

function summaryOf(feature: FeatureDetail): FeatureSummary {
  const { id, title, state, runMode, createdAt } = feature;
  return { id, title, state, runMode, createdAt };
}

function listOf(...features: FeatureDetail[]) {
  return { items: features.map(summaryOf), nextCursor: null };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useFeatureList', () => {
  it('reads feature.list under the infinite feature.list key', async () => {
    answerProcedure('feature/list', listOf(featureFixture()));

    const { result, queryClient } = renderHooks(() => useFeatureList());

    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));
    expect(result.current.hooks.data?.pages[0]?.items.map((feature) => feature.id)).toEqual([
      FEATURE_ID,
    ]);
    const key = result.current.utils.feature.list.key({ type: 'infinite' });
    expect(queryClient.getQueryCache().findAll({ queryKey: key })).toHaveLength(1);
  });

  it('reads the list again every 3 s while a feature is in pre-planning, and stops once none is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answerProcedure(
      'feature/list',
      listOf(featureFixture()),
      listOf(featureFixture({ state: 'plan_ready' })),
    );
    const { result } = renderHooks(() => useFeatureList());
    await waitFor(() =>
      expect(result.current.hooks.data?.pages[0]?.items[0]?.state).toBe('pre_planning'),
    );
    expect(inputs).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() =>
      expect(result.current.hooks.data?.pages[0]?.items[0]?.state).toBe('plan_ready'),
    );
    expect(inputs).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(inputs).toHaveLength(2);
  });

  it('reads the list again every 3 s while an Auto loop feature is in plan ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answerProcedure(
      'feature/list',
      listOf(featureFixture({ state: 'plan_ready', runMode: 'auto_loop' })),
      listOf(featureFixture({ state: 'planning', runMode: 'auto_loop' })),
    );
    const { result } = renderHooks(() => useFeatureList());
    await waitFor(() =>
      expect(result.current.hooks.data?.pages[0]?.items[0]?.state).toBe('plan_ready'),
    );
    expect(inputs).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() =>
      expect(result.current.hooks.data?.pages[0]?.items[0]?.state).toBe('planning'),
    );

    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(inputs).toHaveLength(2);
  });
});

describe('useFeature', () => {
  it('reads feature.get under the feature.get key for the feature id', async () => {
    const inputs = answerProcedure('feature/get', featureFixture({ state: 'plan_ready' }));

    const { result, queryClient } = renderHooks(() => useFeature(FEATURE_ID));

    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));
    expect(inputs).toEqual([{ featureId: FEATURE_ID }]);
    const key = result.current.utils.feature.get.queryKey({ input: { featureId: FEATURE_ID } });
    expect(queryClient.getQueryData(key)).toEqual(featureFixture({ state: 'plan_ready' }));
  });

  it('reads the feature again every 3 s while it is in pre-planning, and stops once it is plan ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answerProcedure(
      'feature/get',
      featureFixture(),
      featureFixture({ state: 'plan_ready' }),
    );
    const { result } = renderHooks(() => useFeature(FEATURE_ID));
    await waitFor(() => expect(result.current.hooks.data?.state).toBe('pre_planning'));

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(result.current.hooks.data?.state).toBe('plan_ready'));
    expect(inputs).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(inputs).toHaveLength(2);
  });

  it('reads an Auto loop feature in plan ready again every 3 s, and stops once it is planning', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answerProcedure(
      'feature/get',
      featureFixture({ state: 'plan_ready', runMode: 'auto_loop' }),
      featureFixture({ state: 'planning', runMode: 'auto_loop' }),
    );
    const { result } = renderHooks(() => useFeature(FEATURE_ID));
    await waitFor(() => expect(result.current.hooks.data?.state).toBe('plan_ready'));

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(result.current.hooks.data?.state).toBe('planning'));
    expect(inputs).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(inputs).toHaveLength(2);
  });

  it('does not read a Manual feature in plan ready again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answerProcedure('feature/get', featureFixture({ state: 'plan_ready' }));
    const { result } = renderHooks(() => useFeature(FEATURE_ID));
    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));

    await act(() => vi.advanceTimersByTimeAsync(9_000));

    expect(inputs).toHaveLength(1);
  });

  it('refetches the feature list when a read finds a new state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gets = answerProcedure(
      'feature/get',
      featureFixture(),
      featureFixture(),
      featureFixture({ state: 'plan_ready' }),
    );
    const lists = answerProcedure('feature/list', listOf(featureFixture({ state: 'plan_ready' })));
    const { result } = renderHooks(() => ({
      feature: useFeature(FEATURE_ID),
      list: useFeatureList(),
    }));
    await waitFor(() => expect(result.current.hooks.list.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hooks.feature.data?.state).toBe('pre_planning'));

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(gets).toHaveLength(2));
    expect(lists).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(result.current.hooks.feature.data?.state).toBe('plan_ready'));
    expect(lists).toHaveLength(2);
  });
});

/** Renders a mutation hook beside a loaded feature and feature list. */
async function renderLoaded<T>(useMutationHook: () => T) {
  const lists = answerProcedure('feature/list', listOf(featureFixture({ state: 'plan_ready' })));
  answerProcedure('feature/get', featureFixture({ state: 'plan_ready' }));
  const view = renderHooks(() => ({
    mutation: useMutationHook(),
    feature: useFeature(FEATURE_ID),
    list: useFeatureList(),
  }));
  await waitFor(() => expect(view.result.current.hooks.feature.isSuccess).toBe(true));
  await waitFor(() => expect(view.result.current.hooks.list.isSuccess).toBe(true));
  return { ...view, lists };
}

describe('feature mutations', () => {
  it('useCreateFeature writes the new feature to its detail key and refetches the list', async () => {
    const created = featureFixture({ id: '0199c1a6-9999-7d4e-8f90-a1b2c3d4e5f6' });
    const creates = answerProcedure('feature/create', created);
    const { result, queryClient, lists } = await renderLoaded(() => useCreateFeature());

    await act(() =>
      result.current.hooks.mutation.mutateAsync({
        description: 'Export invoices as CSV.',
        attachments: [],
        exploreCodebase: false,
        researchTopics: [],
        runMode: 'manual',
        repositoryIds: [REPOSITORY_ID],
      }),
    );

    expect(creates).toHaveLength(1);
    const key = result.current.utils.feature.get.queryKey({ input: { featureId: created.id } });
    expect(queryClient.getQueryData(key)).toEqual(created);
    expect(lists).toHaveLength(2);
  });

  it('useUpdateFeature writes the returned feature over the cached one and refetches the list', async () => {
    const updated = featureFixture({ state: 'plan_ready', runMode: 'auto_loop' });
    const updates = answerProcedure('feature/update', updated);
    const { result, lists } = await renderLoaded(() => useUpdateFeature());

    await act(() =>
      result.current.hooks.mutation.mutateAsync({ featureId: FEATURE_ID, runMode: 'auto_loop' }),
    );

    expect(updates).toEqual([{ featureId: FEATURE_ID, runMode: 'auto_loop' }]);
    expect(result.current.hooks.feature.data?.runMode).toBe('auto_loop');
    expect(lists).toHaveLength(2);
  });

  it('useStartPlanning writes the returned feature, refetches the list and invalidates the plan', async () => {
    const starts = answerProcedure('feature/startPlanning', featureFixture({ state: 'planning' }));
    const { result, lists, queryClient } = await renderLoaded(() => useStartPlanning());
    queryClient.setQueryData(
      result.current.utils.plan.get.queryKey({ input: { featureId: FEATURE_ID } }),
      planWorkspaceFixture({ revision: null, turn: null }),
    );

    await act(() => result.current.hooks.mutation.mutateAsync({ featureId: FEATURE_ID }));

    expect(starts).toEqual([{ featureId: FEATURE_ID }]);
    expect(result.current.hooks.feature.data?.state).toBe('planning');
    expect(lists).toHaveLength(2);
    const planKey = result.current.utils.plan.get.queryKey({ input: { featureId: FEATURE_ID } });
    expect(queryClient.getQueryState(planKey)?.isInvalidated).toBe(true);
  });
});

describe('startPlanningConflictReason', () => {
  it('returns the reason of a CONFLICT', async () => {
    server.use(
      http.post(`${RPC_URL}/feature/startPlanning`, () =>
        HttpResponse.json(
          rpcBody({
            defined: true,
            code: 'CONFLICT',
            status: 409,
            message: 'Conflict',
            data: { reason: 'auto_loop' },
          }),
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHooks(() => useStartPlanning());

    act(() => {
      result.current.hooks.mutate({ featureId: FEATURE_ID });
    });

    await waitFor(() => expect(result.current.hooks.isError).toBe(true));
    const { error } = result.current.hooks;
    if (error === null) throw new Error('The mutation has no error');
    expect(startPlanningConflictReason(error)).toBe('auto_loop');
  });
});

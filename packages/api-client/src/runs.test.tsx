import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { isApiError } from './api-error.ts';
import { useApiUtils } from './api-provider.tsx';
import { useCancelRun, useCreateRun, useRun, useRunList } from './runs.ts';
import { RUN_ID, runFixture, RUNNER_ID } from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function answer(path: string, respond: () => Response) {
  const calls = { count: 0 };
  server.use(
    http.post(`${RPC_URL}/${path}`, () => {
      calls.count += 1;
      return respond();
    }),
  );
  return calls;
}

const answerRunList = () =>
  answer('run/list', () => HttpResponse.json(rpcBody({ items: [runFixture()], nextCursor: null })));

describe('useRunList', () => {
  it('reads run.list under the infinite run.list key', async () => {
    answerRunList();
    const queryClient = newQueryClient();
    const { result } = renderHook(() => ({ list: useRunList(), utils: useApiUtils() }), {
      wrapper: apiWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    expect(result.current.list.data?.pages[0]?.items.map((run) => run.id)).toEqual([RUN_ID]);
    expect(result.current.list.hasNextPage).toBe(false);
    const key = result.current.utils.run.list.key({ type: 'infinite' });
    expect(queryClient.getQueryCache().findAll({ queryKey: key })).toHaveLength(1);
  });
});

describe('useRun', () => {
  it('reads run.get under the run.get key for the run id', async () => {
    answer('run/get', () => HttpResponse.json(rpcBody(runFixture())));
    const queryClient = newQueryClient();
    const { result } = renderHook(() => ({ run: useRun(RUN_ID), utils: useApiUtils() }), {
      wrapper: apiWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.run.isSuccess).toBe(true));

    const key = result.current.utils.run.get.queryKey({ input: { runId: RUN_ID } });
    expect(queryClient.getQueryData(key)).toEqual(runFixture());
  });

  it('reports NOT_FOUND as that defined error', async () => {
    answer('run/get', () =>
      HttpResponse.json(
        rpcBody({ defined: true, code: 'NOT_FOUND', status: 404, message: 'Not found' }),
        { status: 404 },
      ),
    );
    const { result } = renderHook(() => useRun(RUN_ID), { wrapper: apiWrapper(newQueryClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isApiError(result.current.error, 'NOT_FOUND')).toBe(true);
  });
});

describe('useCreateRun', () => {
  it('writes the new run to its detail key and refetches the run list', async () => {
    const created = runFixture({ id: '0199c1a3-2222-7d4e-8f90-a1b2c3d4e5f6' });
    const lists = answerRunList();
    answer('run/create', () => HttpResponse.json(rpcBody(created)));
    const queryClient = newQueryClient();
    const { result } = renderHook(
      () => ({ list: useRunList(), create: useCreateRun(), utils: useApiUtils() }),
      { wrapper: apiWrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(() =>
      result.current.create.mutateAsync({
        runnerId: RUNNER_ID,
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
      }),
    );

    const key = result.current.utils.run.get.queryKey({ input: { runId: created.id } });
    expect(queryClient.getQueryData(key)).toEqual(created);
    expect(lists.count).toBe(2);
  });
});

describe('useCancelRun', () => {
  it('writes the returned run over the cached one and refetches the run list', async () => {
    const lists = answerRunList();
    answer('run/get', () => HttpResponse.json(rpcBody(runFixture({ status: 'running' }))));
    const cancelled = runFixture({ status: 'running', cancelRequested: true });
    const cancels = answer('run/cancel', () => HttpResponse.json(rpcBody(cancelled)));
    const { result } = renderHook(
      () => ({ list: useRunList(), run: useRun(RUN_ID), cancel: useCancelRun() }),
      { wrapper: apiWrapper(newQueryClient()) },
    );
    await waitFor(() => expect(result.current.run.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(() => result.current.cancel.mutateAsync({ runId: RUN_ID }));

    expect(cancels.count).toBe(1);
    await waitFor(() => expect(result.current.run.data?.cancelRequested).toBe(true));
    expect(lists.count).toBe(2);
  });
});

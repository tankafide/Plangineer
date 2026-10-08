import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useApiUtils } from './api-provider.tsx';
import { useRunList } from './runs.ts';
import {
  useApproveRunnerLogin,
  useDenyRunnerLogin,
  useRevokeRunner,
  useRunnerList,
  useRunnerLogin,
} from './runners.ts';
import { runFixture, RUNNER_ID, runnerFixture } from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

const NEXT_RUNNER_ID = '0199c1a2-0000-7d4e-8f90-a1b2c3d4e5f6';

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers a procedure, recording each request's input. */
function answer(path: string, respond: (input: unknown) => Response) {
  const inputs: unknown[] = [];
  server.use(
    http.post(`${RPC_URL}/${path}`, async ({ request }) => {
      const body: unknown = await request.json();
      const input = typeof body === 'object' && body !== null && 'json' in body ? body.json : null;
      inputs.push(input);
      return respond(input);
    }),
  );
  return inputs;
}

describe('useRunnerList', () => {
  it('pages through runner.list by cursor under the infinite runner.list key', async () => {
    const inputs = answer('runner/list', (input) =>
      HttpResponse.json(
        rpcBody(
          input !== null && typeof input === 'object' && 'cursor' in input
            ? { items: [runnerFixture({ id: NEXT_RUNNER_ID })], nextCursor: null }
            : { items: [runnerFixture()], nextCursor: RUNNER_ID },
        ),
      ),
    );
    const queryClient = newQueryClient();
    const { result } = renderHook(() => ({ list: useRunnerList(), utils: useApiUtils() }), {
      wrapper: apiWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.hasNextPage).toBe(true);

    await act(() => result.current.list.fetchNextPage());

    expect(inputs).toEqual([{}, { cursor: RUNNER_ID }]);
    await waitFor(() => expect(result.current.list.hasNextPage).toBe(false));
    expect(result.current.list.data?.pages.flatMap((page) => page.items.map((r) => r.id))).toEqual([
      RUNNER_ID,
      NEXT_RUNNER_ID,
    ]);
    const cached = queryClient
      .getQueryCache()
      .findAll({ queryKey: result.current.utils.runner.list.key({ type: 'infinite' }) });
    expect(cached).toHaveLength(1);
  });
});

const USER_CODE = 'ABCD-EFGH-JKMN';

function loginFixture(status: 'pending' | 'approved' | 'denied') {
  return {
    name: 'ada-laptop',
    platform: 'linux',
    status,
    requestedAt: '2026-10-08T10:00:00.000Z',
    expiresAt: '2026-10-08T10:10:00.000Z',
  };
}

describe('useRunnerLogin', () => {
  it('loads the login request by its user code', async () => {
    const inputs = answer('runner/getLogin', () =>
      HttpResponse.json(rpcBody(loginFixture('pending'))),
    );
    const { result } = renderHook(() => useRunnerLogin(USER_CODE), {
      wrapper: apiWrapper(newQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(inputs).toEqual([{ userCode: USER_CODE }]);
    expect(result.current.data?.status).toBe('pending');
  });

  it('sends nothing while the user code is undefined', () => {
    const inputs = answer('runner/getLogin', () =>
      HttpResponse.json(rpcBody(loginFixture('pending'))),
    );
    const { result } = renderHook(() => useRunnerLogin(undefined), {
      wrapper: apiWrapper(newQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(inputs).toEqual([]);
  });
});

describe('useApproveRunnerLogin and useDenyRunnerLogin', () => {
  it.each([
    ['approving', 'runner/approveLogin', 'approved', useApproveRunnerLogin],
    ['denying', 'runner/denyLogin', 'denied', useDenyRunnerLogin],
  ] as const)(
    '%s updates the cached login request and leaves the runner list alone',
    async (_name, path, status, useDecision) => {
      answer('runner/getLogin', () => HttpResponse.json(rpcBody(loginFixture('pending'))));
      const runnerLists = answer('runner/list', () =>
        HttpResponse.json(rpcBody({ items: [], nextCursor: null })),
      );
      answer(path, () => HttpResponse.json(rpcBody(loginFixture(status))));
      const { result } = renderHook(
        () => ({
          login: useRunnerLogin(USER_CODE),
          decide: useDecision(),
          runners: useRunnerList(),
        }),
        { wrapper: apiWrapper(newQueryClient()) },
      );
      await waitFor(() => expect(result.current.login.data?.status).toBe('pending'));
      await waitFor(() => expect(result.current.runners.isSuccess).toBe(true));

      await act(() => result.current.decide.mutateAsync({ userCode: USER_CODE }));

      await waitFor(() => expect(result.current.login.data?.status).toBe(status));
      expect(runnerLists).toHaveLength(1);
    },
  );
});

describe('useRevokeRunner', () => {
  it('revokes the runner, then refetches the runner list and the run list', async () => {
    const revoked = runnerFixture({ status: 'revoked', revokedAt: '2026-10-07T11:00:00.000Z' });
    const runnerLists = answer('runner/list', () =>
      HttpResponse.json(rpcBody({ items: [runnerFixture()], nextCursor: null })),
    );
    const runLists = answer('run/list', () =>
      HttpResponse.json(rpcBody({ items: [runFixture()], nextCursor: null })),
    );
    const revokes = answer('runner/revoke', () => HttpResponse.json(rpcBody(revoked)));
    const { result } = renderHook(
      () => ({ runners: useRunnerList(), runs: useRunList(), revoke: useRevokeRunner() }),
      { wrapper: apiWrapper(newQueryClient()) },
    );
    await waitFor(() => expect(result.current.runs.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.runners.isSuccess).toBe(true));

    await act(() => result.current.revoke.mutateAsync({ runnerId: RUNNER_ID }));

    expect(revokes).toEqual([{ runnerId: RUNNER_ID }]);
    expect(runnerLists).toHaveLength(2);
    expect(runLists).toHaveLength(2);
  });
});

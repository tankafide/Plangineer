import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApiUtils } from './api-provider.tsx';
import {
  githubAppSetupFailure,
  useCompleteGithubApp,
  useGithubAppManifest,
  useInstanceStatus,
  useSetupRepositories,
  useSetupRunners,
} from './instance.ts';
import { REPOSITORY_ID, runnerFixture } from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

const SETUP_TOKEN = 's'.repeat(43);
const MISSING = { githubApp: 'missing', githubAppSlug: null };
const CONFIGURED = { githubApp: 'configured', githubAppSlug: 'plangineer-a1b2c3' };

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers a procedure with each response in turn, repeating the last, and records each input. */
function answer(path: string, ...responses: Array<() => Response>) {
  const inputs: unknown[] = [];
  server.use(
    http.post(`${RPC_URL}/${path}`, async ({ request }) => {
      const body: unknown = await request.json();
      inputs.push(typeof body === 'object' && body !== null && 'json' in body ? body.json : null);
      const respond = responses[Math.min(inputs.length - 1, responses.length - 1)];
      if (respond === undefined) throw new Error(`answer needs a response for ${path}`);
      return respond();
    }),
  );
  return inputs;
}

const json = (body: unknown) => () => HttpResponse.json(rpcBody(body));

const githubFailed = () =>
  HttpResponse.json(
    rpcBody({
      defined: true,
      code: 'GITHUB_FAILED',
      status: 502,
      message: 'GitHub request failed',
      data: { status: 404, message: 'Not Found' },
    }),
    { status: 502 },
  );

function renderHooks<T>(useHooks: () => T, queryClient = newQueryClient()) {
  const view = renderHook(() => ({ hooks: useHooks(), utils: useApiUtils() }), {
    wrapper: apiWrapper(queryClient),
  });
  return { ...view, queryClient };
}

/** The error of a failed mutation, which is never null once isError is true. */
function failure<E>(error: E | null): E {
  if (error === null) throw new Error('The mutation has no error');
  return error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useInstanceStatus', () => {
  it('reads instance.getStatus under its query key', async () => {
    answer('instance/getStatus', json({ ...CONFIGURED, internal: 'stripped' }));

    const { result, queryClient } = renderHooks(() => useInstanceStatus());

    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));
    expect(result.current.hooks.data).toEqual(CONFIGURED);
    const key = result.current.utils.instance.getStatus.queryKey();
    expect(queryClient.getQueryData(key)).toEqual(CONFIGURED);
  });
});

describe('useGithubAppManifest', () => {
  it('sends the setup token and resolves to the post URL and manifest', async () => {
    const output = { postUrl: 'https://github.com/settings/apps/new', manifest: '{"name":"x"}' };
    const inputs = answer('instance/githubAppManifest', json(output));
    const { result } = renderHooks(() => useGithubAppManifest());

    const manifest = await act(() => result.current.hooks.mutateAsync({ setupToken: SETUP_TOKEN }));

    expect(manifest).toEqual(output);
    expect(inputs).toEqual([{ setupToken: SETUP_TOKEN }]);
  });
});

describe('useCompleteGithubApp', () => {
  it('writes the returned status to the status query without refetching it', async () => {
    const statusInputs = answer('instance/getStatus', json(MISSING));
    const inputs = answer('instance/completeGithubApp', json(CONFIGURED));
    const { result } = renderHooks(() => ({
      status: useInstanceStatus(),
      complete: useCompleteGithubApp(),
    }));
    await waitFor(() => expect(result.current.hooks.status.data).toEqual(MISSING));

    await act(() =>
      result.current.hooks.complete.mutateAsync({ setupToken: SETUP_TOKEN, code: 'abc123' }),
    );

    expect(result.current.hooks.status.data).toEqual(CONFIGURED);
    expect(inputs).toEqual([{ setupToken: SETUP_TOKEN, code: 'abc123' }]);
    expect(statusInputs).toHaveLength(1);
  });
});

describe('githubAppSetupFailure', () => {
  it("returns GitHub's message for GITHUB_FAILED", async () => {
    answer('instance/completeGithubApp', githubFailed);
    const { result } = renderHooks(() => useCompleteGithubApp());

    act(() => {
      result.current.hooks.mutate({ setupToken: SETUP_TOKEN, code: 'abc123' });
    });

    await waitFor(() => expect(result.current.hooks.isError).toBe(true));
    expect(githubAppSetupFailure(failure(result.current.hooks.error))).toBe('Not Found');
  });

  it("returns the error's own message for any other error", async () => {
    answer('instance/completeGithubApp', () =>
      HttpResponse.json(
        rpcBody({ defined: false, code: 'UNAUTHORIZED', status: 401, message: 'Wrong token' }),
        { status: 401 },
      ),
    );
    const { result } = renderHooks(() => useCompleteGithubApp());

    act(() => {
      result.current.hooks.mutate({ setupToken: SETUP_TOKEN, code: 'abc123' });
    });

    await waitFor(() => expect(result.current.hooks.isError).toBe(true));
    expect(githubAppSetupFailure(failure(result.current.hooks.error))).toBe('Wrong token');
  });
});

describe('useSetupRunners', () => {
  it('reads the first 100 runners and reads them again every 5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inputs = answer('runner/list', json({ items: [runnerFixture()], nextCursor: null }));
    const { result } = renderHooks(() => useSetupRunners(true));
    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));
    expect(inputs).toEqual([{ limit: 100 }]);

    await act(() => vi.advanceTimersByTimeAsync(5_000));

    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(result.current.hooks.data?.items.map((runner) => runner.name)).toEqual(['ada-laptop']);
  });

  it('sends nothing while disabled', async () => {
    const inputs = answer('runner/list', json({ items: [], nextCursor: null }));
    const { result } = renderHooks(() => useSetupRunners(false));

    await act(() => Promise.resolve());

    expect(result.current.hooks.fetchStatus).toBe('idle');
    expect(inputs).toEqual([]);
  });
});

describe('useSetupRepositories', () => {
  const repository = {
    id: REPOSITORY_ID,
    owner: 'acme',
    name: 'web-app',
    description: 'The customer web app.',
    defaultRunMode: 'manual',
    setupStatus: null,
  };

  it('reads one repository', async () => {
    const inputs = answer('repository/list', json({ items: [repository], nextCursor: null }));
    const { result } = renderHooks(() => useSetupRepositories(true));

    await waitFor(() => expect(result.current.hooks.isSuccess).toBe(true));

    expect(inputs).toEqual([{ limit: 1 }]);
    expect(result.current.hooks.data?.items).toEqual([repository]);
  });

  it('sends nothing while disabled', async () => {
    const inputs = answer('repository/list', json({ items: [], nextCursor: null }));
    const { result } = renderHooks(() => useSetupRepositories(false));

    await act(() => Promise.resolve());

    expect(result.current.hooks.fetchStatus).toBe('idle');
    expect(inputs).toEqual([]);
  });
});

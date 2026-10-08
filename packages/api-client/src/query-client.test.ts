import { renderHook, waitFor } from '@testing-library/react';
import { MutationObserver } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useMe } from './me.ts';
import { createQueryClient } from './query-client.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

/** The app's QueryClient, with retries made immediate so the test does not wait out the backoff. */
function immediateRetryClient() {
  const queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retryDelay: 0 } });
  return queryClient;
}

function countCalls(response: () => Response) {
  const calls = { count: 0 };
  server.use(
    http.post(`${RPC_URL}/me/get`, () => {
      calls.count += 1;
      return response();
    }),
  );
  return calls;
}

describe('createQueryClient', () => {
  it('retries a 503 twice, then fails', async () => {
    const calls = countCalls(() =>
      HttpResponse.json(
        rpcBody({ defined: false, code: 'SERVICE_UNAVAILABLE', status: 503, message: 'down' }),
        { status: 503 },
      ),
    );

    const { result } = renderHook(() => useMe(), { wrapper: apiWrapper(immediateRetryClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls.count).toBe(3);
  });

  it('does not retry a 401', async () => {
    const calls = countCalls(() =>
      HttpResponse.json(
        rpcBody({ defined: true, code: 'UNAUTHORIZED', status: 401, message: 'Unauthorized' }),
        { status: 401 },
      ),
    );

    const { result } = renderHook(() => useMe(), { wrapper: apiWrapper(immediateRetryClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls.count).toBe(1);
  });

  it('never retries a mutation', async () => {
    const calls = { count: 0 };
    const observer = new MutationObserver(immediateRetryClient(), {
      mutationFn: () => {
        calls.count += 1;
        return Promise.reject(new TypeError('Failed to fetch'));
      },
    });

    await expect(observer.mutate()).rejects.toThrow('Failed to fetch');
    expect(calls.count).toBe(1);
  });
});

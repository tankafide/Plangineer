import { ValidationError } from '@orpc/contract';
import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useMe } from './me.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

const USER = {
  id: '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'member',
};

function renderUseMe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useMe(), { wrapper: apiWrapper(queryClient) });
}

describe('useMe', () => {
  it('fetches /rpc/me/get and resolves to the parsed user', async () => {
    server.use(
      http.post(`${RPC_URL}/me/get`, ({ request }) =>
        request.headers.get('x-csrf-token') === 'orpc'
          ? HttpResponse.json(rpcBody({ ...USER, internal: 'stripped' }))
          : HttpResponse.json(rpcBody({ code: 'FORBIDDEN' }), { status: 403 }),
      ),
    );

    const { result } = renderUseMe();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(USER);
  });

  it('rejects a response that breaks MeGetOutput with a validation error', async () => {
    server.use(
      http.post(`${RPC_URL}/me/get`, () => HttpResponse.json(rpcBody({ ...USER, role: 'owner' }))),
    );

    const { result } = renderUseMe();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ValidationError);
    expect(result.current.data).toBeUndefined();
  });
});

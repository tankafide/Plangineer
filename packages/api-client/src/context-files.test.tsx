import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useApiUtils } from './api-provider.tsx';
import { useContextFile, useDeleteContextFile, useUpdateContextFile } from './context-files.ts';
import { useFeature } from './features.ts';
import {
  CONTEXT_FILE_ID,
  contextFileFixture,
  FEATURE_ID,
  featureFixture,
} from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers a procedure with the body and records each input. */
function answer(path: string, body: unknown) {
  const inputs: unknown[] = [];
  server.use(
    http.post(`${RPC_URL}/${path}`, async ({ request }) => {
      const sent: unknown = await request.json();
      inputs.push(typeof sent === 'object' && sent !== null && 'json' in sent ? sent.json : null);
      return HttpResponse.json(rpcBody(body));
    }),
  );
  return inputs;
}

/** Renders a mutation hook beside a loaded context file and its plan-ready feature. */
async function renderLoaded<T>(useMutationHook: () => T) {
  const features = answer('feature/get', featureFixture({ state: 'plan_ready' }));
  answer('contextFile/get', contextFileFixture());
  const queryClient = newQueryClient();
  const view = renderHook(
    () => ({
      mutation: useMutationHook(),
      file: useContextFile(CONTEXT_FILE_ID),
      feature: useFeature(FEATURE_ID),
      utils: useApiUtils(),
    }),
    { wrapper: apiWrapper(queryClient) },
  );
  await waitFor(() => expect(view.result.current.file.data?.title).toBe('Feature brief'));
  await waitFor(() => expect(view.result.current.feature.data?.state).toBe('plan_ready'));
  return { ...view, queryClient, features };
}

describe('useContextFile', () => {
  it('reads contextFile.get under the contextFile.get key for the file id', async () => {
    const inputs = answer('contextFile/get', contextFileFixture());
    const queryClient = newQueryClient();
    const { result } = renderHook(
      () => ({ file: useContextFile(CONTEXT_FILE_ID), utils: useApiUtils() }),
      { wrapper: apiWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.file.isSuccess).toBe(true));

    expect(inputs).toEqual([{ contextFileId: CONTEXT_FILE_ID }]);
    const key = result.current.utils.contextFile.get.queryKey({
      input: { contextFileId: CONTEXT_FILE_ID },
    });
    expect(queryClient.getQueryData(key)).toEqual(contextFileFixture());
  });
});

describe('useUpdateContextFile', () => {
  it("writes the returned file over the cached one and refetches the file's feature", async () => {
    const renamed = contextFileFixture({ title: 'Brief', ticked: false });
    const updates = answer('contextFile/update', renamed);
    const { result, features } = await renderLoaded(() => useUpdateContextFile());

    await act(() =>
      result.current.mutation.mutateAsync({
        contextFileId: CONTEXT_FILE_ID,
        title: 'Brief',
        ticked: false,
      }),
    );

    expect(updates).toEqual([{ contextFileId: CONTEXT_FILE_ID, title: 'Brief', ticked: false }]);
    expect(result.current.file.data).toEqual(renamed);
    expect(features).toHaveLength(2);
  });
});

describe('useDeleteContextFile', () => {
  it('drops the cached file and refetches the feature', async () => {
    const deletes = answer('contextFile/delete', { id: CONTEXT_FILE_ID });
    const { result, queryClient, features } = await renderLoaded(() => useDeleteContextFile());
    server.use(
      http.post(`${RPC_URL}/contextFile/get`, () =>
        HttpResponse.json(
          rpcBody({ defined: true, code: 'NOT_FOUND', status: 404, message: 'Not found' }),
          { status: 404 },
        ),
      ),
    );

    await act(() => result.current.mutation.mutateAsync({ contextFileId: CONTEXT_FILE_ID }));

    expect(deletes).toEqual([{ contextFileId: CONTEXT_FILE_ID }]);
    expect(features).toHaveLength(2);
    const key = result.current.utils.contextFile.get.queryKey({
      input: { contextFileId: CONTEXT_FILE_ID },
    });
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});

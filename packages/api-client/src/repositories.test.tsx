import type { RepositoryDetail } from '@plangineer/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useApiUtils } from './api-provider.tsx';
import {
  useAddRepository,
  useRemoveRepository,
  useRepository,
  useRepositoryList,
  useUpdateRepository,
} from './repositories.ts';
import { useRefreshSetup, useScanRepository, useStartSetup } from './repository-setup.ts';
import { REPOSITORY_ID, repositoryFixture, RUNNER_ID } from './test-fixtures.ts';
import { apiWrapper, RPC_URL, rpcBody, server } from './test-utils.tsx';

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers a procedure and counts its calls. */
function answer(path: string, body: unknown) {
  const calls = { count: 0 };
  server.use(
    http.post(`${RPC_URL}/${path}`, () => {
      calls.count += 1;
      return HttpResponse.json(rpcBody(body));
    }),
  );
  return calls;
}

function listOf(repository: RepositoryDetail) {
  return {
    items: [
      {
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        description: repository.description,
        setupStatus: repository.setup?.status ?? null,
      },
    ],
    nextCursor: null,
  };
}

/** Renders the hooks with a loaded list and repository, so a mutation's effect on both shows. */
async function renderLoaded<T>(useMutationHook: () => T) {
  const stored = repositoryFixture();
  const list = answer('repository/list', listOf(stored));
  answer('repository/get', stored);
  const queryClient = newQueryClient();
  const { result } = renderHook(
    () => ({
      mutation: useMutationHook(),
      list: useRepositoryList(),
      repository: useRepository(REPOSITORY_ID),
      utils: useApiUtils(),
    }),
    { wrapper: apiWrapper(queryClient) },
  );
  await waitFor(() => expect(result.current.repository.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  return { result, list, queryClient };
}

const changed = repositoryFixture({ description: 'Changed by the mutation' });

/** Runs the mutation once the list refetched, and returns the cached repository's description. */
async function mutateStored<T>(
  hook: () => { mutateAsync: (input: T) => Promise<unknown> },
  path: string,
  input: T,
): Promise<string | undefined> {
  const { result, list } = await renderLoaded(hook);
  answer(path, changed);

  await act(() => result.current.mutation.mutateAsync(input));

  await waitFor(() => expect(list.count).toBe(2));
  return result.current.repository.data?.description;
}

describe('repository mutation hooks', () => {
  it('useUpdateRepository replaces the cached repository and refetches the list', async () => {
    expect(
      await mutateStored(useUpdateRepository, 'repository/update', {
        repositoryId: REPOSITORY_ID,
        description: 'Changed by the mutation',
      }),
    ).toBe('Changed by the mutation');
  });

  it('useScanRepository replaces the cached repository and refetches the list', async () => {
    expect(
      await mutateStored(useScanRepository, 'repositorySetup/scan', {
        repositoryId: REPOSITORY_ID,
      }),
    ).toBe('Changed by the mutation');
  });

  it('useStartSetup replaces the cached repository and refetches the list', async () => {
    expect(
      await mutateStored(useStartSetup, 'repositorySetup/start', {
        repositoryId: REPOSITORY_ID,
        runnerId: RUNNER_ID,
        selection: { reuseSkills: [], addSkills: ['testing'], orchestrators: [] },
      }),
    ).toBe('Changed by the mutation');
  });

  it('useRefreshSetup replaces the cached repository and refetches the list', async () => {
    expect(
      await mutateStored(useRefreshSetup, 'repositorySetup/refresh', {
        repositoryId: REPOSITORY_ID,
      }),
    ).toBe('Changed by the mutation');
  });

  it('useAddRepository stores the added repository and refetches the list', async () => {
    const { result, list, queryClient } = await renderLoaded(useAddRepository);
    const added = repositoryFixture({ id: '0199c1a2-1111-7000-8000-000000000009' });
    answer('repository/add', added);

    await act(() =>
      result.current.mutation.mutateAsync({ githubRepositoryId: 9, description: 'New' }),
    );

    expect(
      queryClient.getQueryData(
        result.current.utils.repository.get.queryKey({ input: { repositoryId: added.id } }),
      ),
    ).toEqual(added);
    await waitFor(() => expect(list.count).toBe(2));
  });

  it('useRemoveRepository drops the cached repository and refetches the list', async () => {
    const { result, list, queryClient } = await renderLoaded(useRemoveRepository);
    answer('repository/remove', { repositoryId: REPOSITORY_ID });
    const key = result.current.utils.repository.get.queryKey({
      input: { repositoryId: REPOSITORY_ID },
    });

    await act(() => result.current.mutation.mutateAsync({ repositoryId: REPOSITORY_ID }));

    expect(queryClient.getQueryCache().find({ queryKey: key, exact: true })).toBeUndefined();
    await waitFor(() => expect(list.count).toBe(2));
  });
});

import { setupServer } from 'msw/node';
import type { GithubState } from './fake-github-state.ts';
import { githubHandlers } from './github-handlers.ts';

/** An MSW server over a fake GitHub, refusing any request it does not handle. */
export function startFakeGithub() {
  const state: GithubState = {
    repositories: [],
    pullRequests: [],
    tokenRequests: [],
    blobReads: [],
    failures: [],
    tokens: new Map(),
  };
  const server = setupServer(...githubHandlers(state));
  server.listen({ onUnhandledFrame: 'error' });
  return {
    ...state,
    /** Answers every request whose path matches with this status and message. */
    fail(
      pathPattern: RegExp,
      status: number,
      message: string,
      headers: Record<string, string> = {},
    ) {
      state.failures.push({ pathPattern, status, message, headers });
    },
    /** Clears the test's state. Issued tokens stay valid, since the App caches them. */
    reset() {
      state.repositories.length = 0;
      state.pullRequests.length = 0;
      state.tokenRequests.length = 0;
      state.blobReads.length = 0;
      state.failures.length = 0;
    },
    close: () => server.close(),
  };
}

export type FakeGithub = ReturnType<typeof startFakeGithub>;

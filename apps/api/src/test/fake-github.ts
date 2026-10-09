import { setupServer } from 'msw/node';
import type { GithubState } from './fake-github-state.ts';
import { githubHandlers } from './github-handlers.ts';

/** An MSW server over a fake GitHub, refusing any request it does not handle. */
export function startFakeGithub() {
  const state: GithubState = {
    manifestConversions: new Map(),
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
    /** Answers matching requests with this status and message, `times` times or every time. */
    fail(
      pathPattern: RegExp,
      status: number,
      message: string,
      options: { headers?: Record<string, string>; times?: number } = {},
    ) {
      const rule = {
        pathPattern,
        status,
        message,
        headers: options.headers ?? {},
        remaining: options.times ?? Number.POSITIVE_INFINITY,
        hits: 0,
      };
      state.failures.push(rule);
      return rule;
    },
    /** Clears the test's state. Issued tokens stay valid, since the App caches them. */
    reset() {
      state.manifestConversions.clear();
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

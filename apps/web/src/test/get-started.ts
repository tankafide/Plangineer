import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_URL, server } from './app-harness.tsx';
import {
  answerJson,
  answerMe,
  answerProcedure,
  page,
  repositorySummaryFixture,
  runnerFixture,
} from './fixtures.ts';

export const SETUP_TOKEN = 'Zm9vYmFyLWJhei1xdXV4LXNldHVwLXRva2VuLTQzY2g';
export const MANIFEST_STATE = 'c3RhdGUtZnJvbS10aGlzLXNldHVw';
export const SLUG = 'plangineer-a1b2c3';
export const MISSING = { githubApp: 'missing', githubAppSlug: null };
export const CONFIGURED = { githubApp: 'configured', githubAppSlug: SLUG };

type Respond = () => Response | Promise<Response>;

// Every answer closes its connection, as fixtures.ts explains for RPC answers.
const CLOSE = { headers: { Connection: 'close' } };

export const signedIn = () =>
  HttpResponse.json(
    {
      session: { id: 'session', userId: 'user' },
      user: { id: 'user', name: 'Ada Lovelace', email: 'ada@example.com' },
    },
    CLOSE,
  );

export const signedOut = () => HttpResponse.json(null, CLOSE);

export const sessionFailed = () =>
  HttpResponse.json({ message: 'Database down' }, { status: 500, ...CLOSE });

/**
 * Answers every read of the get-started checklist. By default each step is done: the App is set
 * up, Ada is signed in as an admin, ada-laptop has Claude Code, and acme/web-app is added.
 */
export function answerSetup({
  status = CONFIGURED,
  session = signedIn,
  runners = [runnerFixture()],
  repositories = [repositorySummaryFixture()],
}: {
  status?: unknown;
  session?: Respond;
  runners?: unknown[];
  repositories?: unknown[];
} = {}) {
  answerProcedure('instance/getStatus', answerJson(status));
  server.use(http.get(`${AUTH_URL}/get-session`, session));
  answerProcedure('runner/list', answerJson(page(runners)));
  answerProcedure('repository/list', answerJson(page(repositories)));
  answerMe('admin');
}

export function holdSetupToken() {
  sessionStorage.setItem('plangineer.setupToken', SETUP_TOKEN);
}

/** Queries within the card of the step with this title. */
export async function stepCard(title: string) {
  const heading = await screen.findByRole('heading', { name: title });
  const card = heading.closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error(`No card for step ${title}`);
  return within(card);
}

/** Whether a button or a link styled as one is the primary button. */
export function isPrimary(element: HTMLElement): boolean {
  return element.className.split(' ').includes('bg-primary');
}

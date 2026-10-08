import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AUTH_URL, renderRoute, server } from '@/test/app-harness';
import { answerJson, answerProcedure, answerSignedIn, page } from '@/test/fixtures';

function answerSession(response: () => Response) {
  server.use(http.get(`${AUTH_URL}/get-session`, response));
}

describe('routes', () => {
  it('shows the alert above the GitHub button on /sign-in with an error parameter', async () => {
    answerSession(() => HttpResponse.json(null));

    await renderRoute('/sign-in?error=access_denied');

    const alert = await screen.findByRole('alert');
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(alert.textContent).toContain('GitHub sign-in did not complete. Try again.');
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no alert on /sign-in without an error parameter', async () => {
    answerSession(() => HttpResponse.json(null));

    await renderRoute('/sign-in');

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends a signed-out visit to / on to /sign-in', async () => {
    answerSession(() => HttpResponse.json(null));

    const { router } = await renderRoute('/');

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it.each(['/', '/sign-in'])(
    'shows the error page on %s when the session check fails',
    async (path) => {
      answerSession(() => HttpResponse.json({ message: 'Database down' }, { status: 500 }));

      const { router } = await renderRoute(path);

      expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
      expect(screen.getByText('Session check failed: Database down')).toBeTruthy();
      expect(router.state.location.pathname).toBe(path);
    },
  );

  it('re-runs the session check when Retry is clicked on the error page', async () => {
    let calls = 0;
    answerSession(() => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ message: 'Database down' }, { status: 500 })
        : HttpResponse.json(null);
    });
    await renderRoute('/sign-in');

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  });

  it('sends a signed-out visit to /runs on to /sign-in', async () => {
    answerSession(() => HttpResponse.json(null));

    const { router } = await renderRoute('/runs');

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('shows the header with Account, Runners and Runs above a signed-in screen', async () => {
    answerSignedIn();
    answerProcedure('runner/list', answerJson(page([])));

    await renderRoute('/runners');

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav.textContent).toContain('Account');
    const runners = screen.getByRole('link', { name: 'Runners' });
    expect(runners.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Runs' }).getAttribute('href')).toBe('/runs');
    expect(screen.getByRole('heading', { name: 'Runners' })).toBeTruthy();
  });

  it('shows Page not found for a run id that is not a uuid', async () => {
    answerSignedIn();

    await renderRoute('/runs/not-a-run');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});

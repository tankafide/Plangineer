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
    let failing = true;
    answerSession(() =>
      failing
        ? HttpResponse.json({ message: 'Database down' }, { status: 500 })
        : HttpResponse.json(null),
    );
    // The canonical URL, so the router does not navigate to add the default redirect parameter.
    await renderRoute('/sign-in?redirect=%2F');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    failing = false;

    await userEvent.click(retry);

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  });

  it('sends a signed-out visit to /runs on to /sign-in', async () => {
    answerSession(() => HttpResponse.json(null));

    const { router } = await renderRoute('/runs');

    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('sends a signed-out visit to the approval link on to /sign-in, keeping the link as the return path', async () => {
    answerSession(() => HttpResponse.json(null));
    const requests: unknown[] = [];
    server.use(
      http.post(`${AUTH_URL}/sign-in/social`, async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({
          url: 'https://github.com/login/oauth/authorize',
          redirect: false,
        });
      }),
    );
    const { router } = await renderRoute('/runners/approve?code=ABCD-EFGH-JKMN');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }));

    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toEqual({
      redirect: '/runners/approve?code=ABCD-EFGH-JKMN',
    });
    expect(requests).toEqual([
      expect.objectContaining({
        callbackURL: '/runners/approve?code=ABCD-EFGH-JKMN',
        errorCallbackURL: '/sign-in?redirect=%2Frunners%2Fapprove%3Fcode%3DABCD-EFGH-JKMN',
      }),
    ]);
  });

  it('sends a signed-in visit to /sign-in on to its same-origin redirect', async () => {
    answerSignedIn();
    answerProcedure('runner/list', answerJson(page([])));

    const { router } = await renderRoute('/sign-in?redirect=/runners');

    expect(await screen.findByRole('heading', { name: 'Runners' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/runners');
  });

  it('sends a signed-in visit to /sign-in with an external redirect to /', async () => {
    answerSignedIn();
    answerProcedure('run/list', answerJson(page([])));

    const { router } = await renderRoute('/sign-in?redirect=//example.com');

    await screen.findByRole('navigation', { name: 'Main' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the expired message and sends no request for a malformed approval code', async () => {
    answerSignedIn();
    const inputs = answerProcedure('runner/getLogin', answerJson({}));

    await renderRoute('/runners/approve?code=not-a-code');

    expect(
      await screen.findByText(/This pairing request expired or was already used\./),
    ).toBeTruthy();
    expect(inputs).toEqual([]);
  });

  it('shows the header with Account, Runners, Repositories and Runs above a signed-in screen', async () => {
    answerSignedIn();
    answerProcedure('runner/list', answerJson(page([])));

    await renderRoute('/runners');

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav.textContent).toContain('Account');
    const runners = screen.getByRole('link', { name: 'Runners' });
    expect(runners.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Runs' }).getAttribute('href')).toBe('/runs');
    expect(screen.getByRole('link', { name: 'Repositories' }).getAttribute('href')).toBe(
      '/repositories',
    );
    expect(screen.getByRole('heading', { name: 'Runners' })).toBeTruthy();
  });

  it('shows Page not found for a run id that is not a uuid', async () => {
    answerSignedIn();

    await renderRoute('/runs/not-a-run');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('shows Page not found for a repository id that is not a uuid', async () => {
    answerSignedIn();

    await renderRoute('/repositories/not-a-repository');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});

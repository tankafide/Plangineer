import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AUTH_URL, renderPage, server } from '@/test/app-harness';
import { answerJson, answerProcedure, neverAnswers, rpcError } from '@/test/fixtures';
import { SignInCard } from './sign-in-card';

const ERROR_TEXT = 'GitHub sign-in did not complete. Try again.';
const MISSING = { githubApp: 'missing', githubAppSlug: null };
const CONFIGURED = { githubApp: 'configured', githubAppSlug: 'plangineer-test' };

function renderCard({ failed = false, redirect = '/' } = {}) {
  return renderPage(() => <SignInCard failed={failed} redirect={redirect} />);
}

function gitHubButton() {
  return screen.findByRole('button', { name: 'Sign in with GitHub' });
}

describe('SignInCard', () => {
  it('starts GitHub sign-in that returns to the app on success and on error', async () => {
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
    await renderCard();

    await userEvent.click(await gitHubButton());

    expect(requests).toEqual([
      expect.objectContaining({
        provider: 'github',
        callbackURL: '/',
        errorCallbackURL: '/sign-in?redirect=%2F',
      }),
    ]);
  });

  it('starts sign-in with the return path as the callback and in the error callback', async () => {
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
    await renderCard({ redirect: '/runners/approve?code=ABCD-EFGH-JKMN' });

    await userEvent.click(await gitHubButton());

    expect(requests).toEqual([
      expect.objectContaining({
        callbackURL: '/runners/approve?code=ABCD-EFGH-JKMN',
        errorCallbackURL: '/sign-in?redirect=%2Frunners%2Fapprove%3Fcode%3DABCD-EFGH-JKMN',
      }),
    ]);
  });

  it('shows the error alert and enables the button again when sign-in fails to start', async () => {
    server.use(
      http.post(`${AUTH_URL}/sign-in/social`, () =>
        HttpResponse.json({ message: 'Provider not configured' }, { status: 500 }),
      ),
    );
    await renderCard();

    await userEvent.click(await gitHubButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ERROR_TEXT);
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('shows no alert before a failed attempt', async () => {
    await renderCard();

    await gitHubButton();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error alert above the GitHub button after a failed attempt', async () => {
    await renderCard({ failed: true });

    const button = await gitHubButton();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ERROR_TEXT);
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows Get started in place of the GitHub button while the GitHub App is missing', async () => {
    answerProcedure('instance/getStatus', answerJson(MISSING));

    await renderCard();

    const getStarted = await screen.findByRole('link', { name: 'Get started' });
    expect(getStarted.getAttribute('href')).toBe('/get-started');
    expect(screen.getByText('Plangineer is not set up yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
  });

  it('shows a skeleton button while the setup status loads', async () => {
    answerProcedure('instance/getStatus', neverAnswers);

    await renderCard();

    expect(await screen.findByRole('status', { name: 'Loading sign-in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
  });

  it('shows a failed alert with Try again when the setup status fails, and recovers', async () => {
    answerProcedure(
      'instance/getStatus',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(CONFIGURED),
    );
    await renderCard();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Plangineer could not be reached');
    expect(alert.textContent).toContain('Database down');
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await gitHubButton()).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

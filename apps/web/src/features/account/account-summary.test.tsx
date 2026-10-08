import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AUTH_URL, renderPage, RPC_URL, rpcBody, server } from '@/test/app-harness';
import { AccountSummary } from './account-summary';

const USER = {
  id: '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'member',
};

const serverError = () =>
  HttpResponse.json(
    rpcBody({
      defined: false,
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
      message: 'Database down',
    }),
    { status: 500 },
  );

function answerMe(...responses: Array<() => Response | Promise<Response>>) {
  let call = 0;
  server.use(
    http.post(`${RPC_URL}/me/get`, () => {
      const respond = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (respond === undefined) throw new Error('answerMe needs a response');
      return respond();
    }),
  );
}

const ready = () => HttpResponse.json(rpcBody(USER));

describe('AccountSummary', () => {
  it('shows a skeleton while the account loads', async () => {
    answerMe(async () => {
      await delay('infinite');
      return ready();
    });

    await renderPage(AccountSummary);

    expect(await screen.findByRole('status', { name: 'Loading account' })).toBeTruthy();
  });

  it('shows the user name, email and role when ready', async () => {
    answerMe(ready);

    await renderPage(AccountSummary);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error and a Retry button when loading fails', async () => {
    answerMe(serverError);

    await renderPage(AccountSummary);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your account could not be loaded');
    expect(alert.textContent).toContain('Database down');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('recovers when Retry succeeds', async () => {
    answerMe(serverError, ready);
    await renderPage(AccountSummary);

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the user on screen, marked stale, when a refetch fails', async () => {
    answerMe(ready, serverError);
    const { queryClient } = await renderPage(AccountSummary);
    await screen.findByText('Ada Lovelace');

    await queryClient.refetchQueries();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Stale');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('signs out, clears the cached user and lands on /sign-in', async () => {
    let signedOut = false;
    answerMe(ready);
    server.use(
      http.post(`${AUTH_URL}/sign-out`, () => {
        signedOut = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const { queryClient, router } = await renderPage(AccountSummary);
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign-in page')).toBeTruthy();
    expect(signedOut).toBe(true);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('keeps the user on screen and shows an error when sign-out fails', async () => {
    answerMe(ready);
    server.use(
      http.post(`${AUTH_URL}/sign-out`, () =>
        HttpResponse.json({ message: 'Database down' }, { status: 500 }),
      ),
    );
    const { queryClient, router } = await renderPage(AccountSummary);
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sign out did not complete. Try again.');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(queryClient.getQueryCache().getAll()).not.toEqual([]);
    expect(router.state.location.pathname).toBe('/');
  });
});

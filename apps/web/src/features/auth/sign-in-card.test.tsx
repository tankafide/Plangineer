import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AUTH_URL, server } from '@/test/app-harness';
import { SignInCard } from './sign-in-card';

const ERROR_TEXT = 'GitHub sign-in did not complete. Try again.';

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
    render(<SignInCard failed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));

    expect(requests).toEqual([
      expect.objectContaining({
        provider: 'github',
        callbackURL: '/',
        errorCallbackURL: '/sign-in',
      }),
    ]);
  });

  it('shows the error alert and enables the button again when sign-in fails to start', async () => {
    server.use(
      http.post(`${AUTH_URL}/sign-in/social`, () =>
        HttpResponse.json({ message: 'Provider not configured' }, { status: 500 }),
      ),
    );
    render(<SignInCard failed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ERROR_TEXT);
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('shows no alert before a failed attempt', () => {
    render(<SignInCard failed={false} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error alert above the GitHub button after a failed attempt', () => {
    render(<SignInCard failed />);

    const alert = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(alert.textContent).toContain(ERROR_TEXT);
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

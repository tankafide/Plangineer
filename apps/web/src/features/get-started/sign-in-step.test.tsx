import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/app-harness';
import { neverAnswers } from '@/test/fixtures';
import {
  answerSetup,
  isPrimary,
  MISSING,
  sessionFailed,
  signedIn,
  signedOut,
  stepCard,
} from '@/test/get-started';

const TITLE = 'Sign in';

describe('SignInStep', () => {
  it('waits for the GitHub App with no button', async () => {
    answerSetup({ status: MISSING, session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(step.getByText('Sign in once the GitHub App is ready.')).toBeTruthy();
    expect(step.queryByRole('link')).toBeNull();
  });

  it('offers Sign in with GitHub as the primary button, returning to /get-started', async () => {
    answerSetup({ session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    const link = await step.findByRole('link', { name: 'Sign in with GitHub' });
    expect(link.getAttribute('href')).toBe('/sign-in?redirect=%2Fget-started');
    expect(isPrimary(link)).toBe(true);
  });

  it('names the signed-in user', async () => {
    answerSetup();

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('Signed in as Ada Lovelace.')).toBeTruthy();
    expect(step.getByText('Done')).toBeTruthy();
  });

  it('shows a skeleton line while the session loads', async () => {
    answerSetup({ session: neverAnswers });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(step.getByRole('status', { name: 'Loading your session' })).toBeTruthy();
  });

  it('shows a failed line with Try again when the session check fails, and recovers', async () => {
    let failing = true;
    answerSetup({ session: () => (failing ? sessionFailed() : signedIn()) });
    await renderRoute('/get-started');
    const step = await stepCard(TITLE);

    const alert = await step.findByRole('alert');
    expect(alert.textContent).toContain('Your session could not be loaded');
    expect(alert.textContent).toContain('Session check failed: Database down');
    failing = false;
    await userEvent.click(step.getByRole('button', { name: 'Try again' }));

    expect(await step.findByText('Signed in as Ada Lovelace.')).toBeTruthy();
  });
});

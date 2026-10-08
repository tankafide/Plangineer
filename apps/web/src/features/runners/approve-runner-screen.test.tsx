import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { answerJson, answerProcedure, neverAnswers, rpcError } from '@/test/fixtures';
import { ApproveRunnerScreen } from './approve-runner-screen';

const USER_CODE = 'ABCD-EFGH-JKMN';

function loginFixture(status: 'pending' | 'approved' | 'denied' = 'pending', name = 'build-box') {
  return {
    name,
    platform: 'win32',
    status,
    requestedAt: '2026-10-08T10:00:00.000Z',
    expiresAt: '2026-10-08T10:10:00.000Z',
  };
}

const renderScreen = (userCode: string | undefined) =>
  renderPage(() => <ApproveRunnerScreen userCode={userCode} />);

const EXPIRED = /This pairing request expired or was already used\./;

describe('ApproveRunnerScreen', () => {
  it("shows the login request's name, platform and user code, with Approve and Deny", async () => {
    const inputs = answerProcedure('runner/getLogin', answerJson(loginFixture()));

    await renderScreen(USER_CODE);

    expect(await screen.findByRole('heading', { name: 'Pair build-box?' })).toBeTruthy();
    expect(screen.getByText('Windows')).toBeTruthy();
    expect(screen.getByText(USER_CODE)).toBeTruthy();
    expect(screen.getByText(/Approve only if you just ran/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(inputs).toEqual([{ userCode: USER_CODE }]);
  });

  it('shows the approved state after Approve', async () => {
    answerProcedure('runner/getLogin', answerJson(loginFixture()));
    const approvals = answerProcedure('runner/approveLogin', answerJson(loginFixture('approved')));
    await renderScreen(USER_CODE);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(
      await screen.findByText('Approved. Your terminal finishes pairing on its own.'),
    ).toBeTruthy();
    expect(approvals).toEqual([{ userCode: USER_CODE }]);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Runners' })).toBeTruthy();
  });

  it('shows the denied state after Deny', async () => {
    answerProcedure('runner/getLogin', answerJson(loginFixture()));
    const denials = answerProcedure('runner/denyLogin', answerJson(loginFixture('denied')));
    await renderScreen(USER_CODE);

    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('Denied. Nothing was paired.')).toBeTruthy();
    expect(denials).toEqual([{ userCode: USER_CODE }]);
  });

  it('shows the expired message with no buttons for an unknown or expired user code', async () => {
    answerProcedure('runner/getLogin', rpcError('NOT_FOUND', 404));

    await renderScreen(USER_CODE);

    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a skeleton while loading', async () => {
    answerProcedure('runner/getLogin', neverAnswers);

    await renderScreen(USER_CODE);

    expect(await screen.findByRole('status', { name: 'Loading pairing request' })).toBeTruthy();
  });

  it('shows the error and Retry when the load fails, and loads again on Retry', async () => {
    const inputs = answerProcedure(
      'runner/getLogin',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(loginFixture()),
    );
    await renderScreen(USER_CODE);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Pair build-box?' })).toBeTruthy();
    expect(inputs).toHaveLength(2);
  });

  it('keeps the card on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'runner/getLogin',
      answerJson(loginFixture()),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderScreen(USER_CODE);
    await screen.findByRole('heading', { name: 'Pair build-box?' });

    await queryClient.refetchQueries();

    expect((await screen.findByRole('alert')).textContent).toContain('Stale');
    expect(screen.getByRole('heading', { name: 'Pair build-box?' })).toBeTruthy();
  });

  it('shows a CONFLICT from Approve under the button, with both buttons enabled', async () => {
    answerProcedure('runner/getLogin', answerJson(loginFixture()));
    answerProcedure('runner/approveLogin', rpcError('CONFLICT', 409));
    await renderScreen(USER_CODE);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This request was already decided. Reload to see its state.');
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows a network failure of Deny under the button, with both buttons enabled', async () => {
    answerProcedure('runner/getLogin', answerJson(loginFixture()));
    answerProcedure('runner/denyLogin', rpcError('INTERNAL_SERVER_ERROR', 500));
    await renderScreen(USER_CODE);

    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not reach Plangineer. Try again.');
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['Approve', 'Deny'])(
    'shows the expired state with no buttons for a NOT_FOUND from %s',
    async (button) => {
      answerProcedure('runner/getLogin', answerJson(loginFixture()));
      answerProcedure('runner/approveLogin', rpcError('NOT_FOUND', 404));
      answerProcedure('runner/denyLogin', rpcError('NOT_FOUND', 404));
      await renderScreen(USER_CODE);

      await userEvent.click(await screen.findByRole('button', { name: button }));

      expect(await screen.findByText(EXPIRED)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('shows the expired message and sends no request without a user code', async () => {
    const inputs = answerProcedure('runner/getLogin', answerJson(loginFixture()));

    await renderScreen(undefined);

    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(inputs).toEqual([]);
  });

  it('shows the approved state for a login request loaded as approved', async () => {
    answerProcedure('runner/getLogin', answerJson(loginFixture('approved')));

    await renderScreen(USER_CODE);

    expect(
      await screen.findByText('Approved. Your terminal finishes pairing on its own.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

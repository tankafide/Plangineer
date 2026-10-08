import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  neverAnswers,
  page,
  rpcError,
  RUNNER_ID,
  runnerFixture,
} from '@/test/fixtures';
import { RunnersScreen } from './runners-screen';

const OTHER_RUNNER_ID = '0199c1a2-0000-7d4e-8f90-a1b2c3d4e5f6';

function runnerCard(name: string) {
  const heading = screen.getByRole('heading', { name });
  const card = heading.closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error(`No card for runner ${name}`);
  return within(card);
}

describe('RunnersScreen', () => {
  it('shows a skeleton while the runners load', async () => {
    answerProcedure('runner/list', neverAnswers);

    await renderPage(RunnersScreen);

    expect(await screen.findByRole('status', { name: 'Loading runners' })).toBeTruthy();
  });

  it('lists runners with their online state and Claude Code status', async () => {
    answerProcedure(
      'runner/list',
      answerJson(
        page([
          runnerFixture(),
          runnerFixture({
            id: OTHER_RUNNER_ID,
            name: 'build-box',
            online: false,
            platform: 'win32',
            clis: [
              {
                name: 'claude-code',
                version: '2.1.100',
                available: false,
                minimumVersion: '2.1.284',
              },
            ],
            planLimitResetsAt: '2026-10-07T15:00:00.000Z',
          }),
        ]),
      ),
    );

    await renderPage(RunnersScreen);

    await screen.findByRole('heading', { name: 'ada-laptop' });
    const online = runnerCard('ada-laptop');
    expect(online.getByText('Online')).toBeTruthy();
    expect(online.getByText('Claude Code 2.1.290')).toBeTruthy();
    expect(online.getByText('Linux')).toBeTruthy();
    const offline = runnerCard('build-box');
    expect(offline.getByText('Offline')).toBeTruthy();
    expect(offline.getByText('Windows')).toBeTruthy();
    expect(offline.getByText('Claude Code unavailable, needs 2.1.284 or later')).toBeTruthy();
    expect(
      offline.getByText(/Reached its Claude plan limit\. Runs resume after .+\./),
    ).toBeTruthy();
  });

  it('shows a revoked runner as Revoked with its date and no Revoke button', async () => {
    answerProcedure(
      'runner/list',
      answerJson(
        page([runnerFixture({ status: 'revoked', revokedAt: '2026-10-07T11:00:00.000Z' })]),
      ),
    );

    await renderPage(RunnersScreen);

    await screen.findByRole('heading', { name: 'ada-laptop' });
    const card = runnerCard('ada-laptop');
    expect(card.getAllByText('Revoked')).toHaveLength(2);
    expect(card.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows the pairing command after Pair a runner, and hides it on Done', async () => {
    answerProcedure('runner/list', answerJson(page([])));
    answerProcedure(
      'runner/createPairingCode',
      answerJson({ code: 'ABCD-EFGH-JKMN', expiresAt: '2026-10-07T10:10:00.000Z' }),
    );
    await renderPage(RunnersScreen);

    await userEvent.click(screen.getByRole('button', { name: 'Pair a runner' }));

    const command = `pnpm runner pair --server ${window.location.origin} --code ABCD-EFGH-JKMN`;
    expect(await screen.findByText(command)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
    expect(screen.getByText(/The code works once and expires at .+\./)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByText(command)).toBeNull();
    expect(screen.getByRole('button', { name: 'Pair a runner' })).toBeTruthy();
  });

  it('says to wait when too many pairing codes were created', async () => {
    answerProcedure('runner/list', answerJson(page([])));
    answerProcedure('runner/createPairingCode', rpcError('TOO_MANY_REQUESTS', 429));
    await renderPage(RunnersScreen);

    await userEvent.click(screen.getByRole('button', { name: 'Pair a runner' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Too many pairing codes. Try again in a few minutes.');
  });

  it('revokes a runner only after Revoke runner is confirmed', async () => {
    const revoked = runnerFixture({ status: 'revoked', revokedAt: '2026-10-07T11:00:00.000Z' });
    answerProcedure(
      'runner/list',
      answerJson(page([runnerFixture()])),
      answerJson(page([revoked])),
    );
    const revokes = answerProcedure('runner/revoke', answerJson(revoked));
    await renderPage(RunnersScreen);
    await screen.findByRole('heading', { name: 'ada-laptop' });

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep runner' }));
    expect(revokes).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke runner' }));

    expect(await screen.findAllByText('Revoked')).toHaveLength(2);
    expect(revokes).toEqual([{ runnerId: RUNNER_ID }]);
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows No runners yet when there are none', async () => {
    answerProcedure('runner/list', answerJson(page([])));

    await renderPage(RunnersScreen);

    expect(await screen.findByText('No runners yet')).toBeTruthy();
  });

  it('shows the error and Retry when the runners fail to load, and recovers', async () => {
    answerProcedure(
      'runner/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([runnerFixture()])),
    );
    await renderPage(RunnersScreen);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Runners could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'ada-laptop' })).toBeTruthy();
  });

  it('keeps the runners on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'runner/list',
      answerJson(page([runnerFixture()])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderPage(RunnersScreen);
    await screen.findByRole('heading', { name: 'ada-laptop' });

    await queryClient.refetchQueries();

    expect((await screen.findByRole('alert')).textContent).toContain('Stale');
    expect(screen.getByRole('heading', { name: 'ada-laptop' })).toBeTruthy();
  });

  it('loads the next page with Load more', async () => {
    const inputs = answerProcedure(
      'runner/list',
      answerJson(page([runnerFixture()], RUNNER_ID)),
      answerJson(page([runnerFixture({ id: OTHER_RUNNER_ID, name: 'build-box' })])),
    );
    await renderPage(RunnersScreen);
    await screen.findByRole('heading', { name: 'ada-laptop' });

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('heading', { name: 'build-box' })).toBeTruthy();
    expect(inputs).toEqual([{}, { cursor: RUNNER_ID }]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

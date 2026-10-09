import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage, renderRoute } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  page,
  repositorySummaryFixture,
  rpcError,
  runnerFixture,
} from '@/test/fixtures';
import { answerSetup } from '@/test/get-started';
import { GetStartedCard } from './get-started-card';

const HEADING = 'Finish setting up Plangineer';
const OFFLINE = runnerFixture({ online: false });

describe('GetStartedCard', () => {
  it.each([
    ['Claude Code is not ready', [OFFLINE], [repositorySummaryFixture()]],
    ['no repository is added', [runnerFixture()], []],
    ['neither is done', [], []],
  ])('links to /get-started while %s', async (_, runners, repositories) => {
    answerSetup({ runners, repositories });

    await renderPage(GetStartedCard);

    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link.getAttribute('href')).toBe('/get-started');
  });

  it('hides once Claude Code is ready and a repository is added', async () => {
    answerSetup();
    const runners = answerProcedure('runner/list', answerJson(page([runnerFixture()])));
    const repositories = answerProcedure(
      'repository/list',
      answerJson(page([repositorySummaryFixture()])),
    );

    const { queryClient } = await renderPage(GetStartedCard);

    await waitFor(() => {
      expect([runners.length, repositories.length]).toEqual([1, 1]);
      expect(queryClient.isFetching()).toBe(0);
    });
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull();
  });

  it('shows the error and Try again when the progress fails, and recovers', async () => {
    answerSetup({ runners: [OFFLINE] });
    answerProcedure(
      'repository/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([])),
    );
    await renderPage(GetStartedCard);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Setup progress could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Get started' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sits above the account summary on the home page', async () => {
    answerSetup({ repositories: [] });

    await renderRoute('/');

    const card = await screen.findByRole('heading', { name: HEADING });
    const account = await screen.findByRole('heading', { name: 'Your account' });
    expect(card.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

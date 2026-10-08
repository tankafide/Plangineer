import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerMe,
  answerProcedure,
  INSTALL_URL,
  neverAnswers,
  page,
  REPOSITORY_ID,
  repositorySummaryFixture,
  rpcError,
} from '@/test/fixtures';
import { RepositoriesScreen } from './repositories-screen';

const OTHER_REPOSITORY_ID = '0199c1a4-0000-7d4e-8f90-a1b2c3d4e5f6';

function answerNothingInstallable() {
  answerProcedure(
    'repository/listInstallable',
    answerJson({ items: [], truncated: false, installUrl: INSTALL_URL }),
  );
}

describe('RepositoriesScreen', () => {
  it('shows a skeleton while the repositories load', async () => {
    answerMe('member');
    answerProcedure('repository/list', neverAnswers);

    await renderPage(RepositoriesScreen);

    expect(await screen.findByRole('status', { name: 'Loading repositories' })).toBeTruthy();
  });

  it('shows No repositories yet when there are none', async () => {
    answerMe('member');
    answerProcedure('repository/list', answerJson(page([])));

    await renderPage(RepositoriesScreen);

    expect(await screen.findByText('No repositories yet')).toBeTruthy();
  });

  it('shows the error and Retry when the repositories fail to load, and recovers', async () => {
    answerMe('member');
    answerProcedure(
      'repository/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([repositorySummaryFixture()])),
    );
    await renderPage(RepositoriesScreen);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Repositories could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: /acme\/web-app/ })).toBeTruthy();
  });

  it('keeps the repositories on screen, marked stale, when a refetch fails', async () => {
    answerMe('member');
    answerProcedure(
      'repository/list',
      answerJson(page([repositorySummaryFixture()])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderPage(RepositoriesScreen);
    await screen.findByRole('link', { name: /acme\/web-app/ });

    await queryClient.refetchQueries({ queryKey: [['repository', 'list']] });

    expect((await screen.findByRole('alert')).textContent).toContain('Stale');
    expect(screen.getByRole('link', { name: /acme\/web-app/ })).toBeTruthy();
  });

  it('lists each repository with its description and setup status, linking to its page', async () => {
    answerMe('member');
    answerProcedure(
      'repository/list',
      answerJson(
        page([
          repositorySummaryFixture(),
          repositorySummaryFixture({
            id: OTHER_REPOSITORY_ID,
            name: 'api',
            description: 'The API.',
            setupStatus: 'pr_open',
          }),
        ]),
      ),
    );

    await renderPage(RepositoriesScreen);

    const first = await screen.findByRole('link', { name: /acme\/web-app/ });
    expect(first.getAttribute('href')).toBe(`/repositories/${REPOSITORY_ID}`);
    expect(within(first).getByText('The customer web app.')).toBeTruthy();
    expect(within(first).getByText('Not scanned')).toBeTruthy();
    const second = screen.getByRole('link', { name: /acme\/api/ });
    expect(within(second).getByText('Pull request open')).toBeTruthy();
  });

  it('shows a member the list and no add card', async () => {
    answerMe('member');
    answerProcedure('repository/list', answerJson(page([repositorySummaryFixture()])));
    const installable = answerProcedure('repository/listInstallable', neverAnswers);

    await renderPage(RepositoriesScreen);

    expect(await screen.findByRole('link', { name: /acme\/web-app/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add a repository' })).toBeNull();
    expect(installable).toEqual([]);
  });

  it('shows an admin the add card beside the list', async () => {
    answerMe('admin');
    answerProcedure('repository/list', answerJson(page([])));
    answerNothingInstallable();

    await renderPage(RepositoriesScreen);

    expect(await screen.findByRole('heading', { name: 'Add a repository' })).toBeTruthy();
    expect(await screen.findByText('No repositories yet')).toBeTruthy();
  });
});

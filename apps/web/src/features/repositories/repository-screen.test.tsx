import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerMe,
  answerProcedure,
  neverAnswers,
  page,
  REPOSITORY_ID,
  repositoryFixture,
  rpcError,
  runnerFixture,
  setupFixture,
} from '@/test/fixtures';
import { RepositoryScreen } from './repository-screen';

function renderScreen() {
  answerProcedure('runner/list', answerJson(page([runnerFixture()])));
  return renderPage(() => <RepositoryScreen repositoryId={REPOSITORY_ID} />);
}

const SCANNED = repositoryFixture({ setup: setupFixture({ status: 'scanned' }) });

describe('RepositoryScreen', () => {
  it('shows a skeleton while the repository loads', async () => {
    answerMe('admin');
    answerProcedure('repository/get', neverAnswers);

    await renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading repository' })).toBeTruthy();
  });

  it('shows Repository not found for NOT_FOUND', async () => {
    answerMe('admin');
    answerProcedure('repository/get', rpcError('NOT_FOUND', 404));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Repository not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to repositories' })).toBeTruthy();
  });

  it('shows the error and Retry when the repository fails to load, and recovers', async () => {
    answerMe('admin');
    answerProcedure(
      'repository/get',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(SCANNED),
    );
    await renderScreen();

    expect((await screen.findByRole('alert')).textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'acme/web-app' })).toBeTruthy();
  });

  it('keeps the repository on screen, marked stale, when a refetch fails', async () => {
    answerMe('admin');
    answerProcedure('repository/get', answerJson(SCANNED), rpcError('INTERNAL_SERVER_ERROR', 500));
    const { queryClient } = await renderScreen();
    await screen.findByRole('heading', { name: 'acme/web-app' });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'acme/web-app' })).toBeTruthy();
  });

  it('shows an admin the setup choices and the settings inputs', async () => {
    answerMe('admin');
    answerProcedure('repository/get', answerJson(SCANNED));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'acme/web-app' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate pull request' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Planning model')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('shows a member the setup and settings with no inputs or buttons', async () => {
    answerMe('member');
    answerProcedure('repository/get', answerJson(SCANNED));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('Scanned')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
  });
});

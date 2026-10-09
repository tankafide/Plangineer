import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/app-harness';
import { answerJson, answerProcedure, neverAnswers, rpcError } from '@/test/fixtures';
import { answerSetup, CONFIGURED, isPrimary, stepCard } from '@/test/get-started';

describe('GetStartedScreen', () => {
  it('shows the four steps in order', async () => {
    answerSetup();

    await renderRoute('/get-started');

    await stepCard('Create the GitHub App');
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['Create the GitHub App', 'Sign in', 'Claude Code', 'Add a repository']);
  });

  it('offers Open Plangineer as the one primary button once every step is done', async () => {
    answerSetup();

    await renderRoute('/get-started');

    const open = await screen.findByRole('link', { name: 'Open Plangineer' });
    expect(open.getAttribute('href')).toBe('/');
    const controls = [...screen.getAllByRole('link'), ...screen.queryAllByRole('button')];
    expect(controls.filter(isPrimary)).toEqual([open]);
  });

  it('shows a skeleton card per step while the setup status loads', async () => {
    answerSetup();
    answerProcedure('instance/getStatus', neverAnswers);

    await renderRoute('/get-started');

    const loading = await screen.findByRole('status', { name: 'Loading setup' });
    expect(loading.querySelectorAll('[data-slot="card"]')).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
  });

  it('shows a failed card with Try again when the setup status fails, and recovers', async () => {
    answerSetup();
    answerProcedure(
      'instance/getStatus',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(CONFIGURED),
    );
    await renderRoute('/get-started');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Setup could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Create the GitHub App' })).toBeTruthy();
  });

  it('keeps the steps and shows Reconnecting when a status refetch fails', async () => {
    answerSetup();
    answerProcedure(
      'instance/getStatus',
      answerJson(CONFIGURED),
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
    );
    const { queryClient } = await renderRoute('/get-started');
    await stepCard('Create the GitHub App');

    await queryClient.refetchQueries();

    expect(await screen.findByText('Reconnecting')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Create the GitHub App' })).toBeTruthy();
  });
});

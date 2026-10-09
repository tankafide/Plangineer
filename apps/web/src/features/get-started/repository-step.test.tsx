import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/app-harness';
import {
  answerJson,
  answerMe,
  answerProcedure,
  neverAnswers,
  page,
  repositorySummaryFixture,
  rpcError,
} from '@/test/fixtures';
import { answerSetup, isPrimary, signedOut, stepCard } from '@/test/get-started';

const TITLE = 'Add a repository';

describe('RepositoryStep', () => {
  it('offers an admin Add repository', async () => {
    answerSetup({ repositories: [] });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    const link = await step.findByRole('link', { name: 'Add repository' });
    expect(link.getAttribute('href')).toBe('/repositories');
    expect(isPrimary(link)).toBe(true);
  });

  it('tells a member that an admin adds repositories', async () => {
    answerSetup({ repositories: [] });
    answerMe('member');

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('An admin adds repositories.')).toBeTruthy();
    expect(step.queryByRole('link')).toBeNull();
  });

  it('names the added repository', async () => {
    answerSetup();

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('acme/web-app')).toBeTruthy();
    expect(step.getByText('Done')).toBeTruthy();
  });

  it('waits for sign-in with no button', async () => {
    answerSetup({ session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('Add a repository once you sign in.')).toBeTruthy();
    expect(step.queryByRole('link')).toBeNull();
  });

  it('shows a failed line with Try again when the repositories fail, and recovers', async () => {
    answerSetup();
    answerProcedure(
      'repository/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([repositorySummaryFixture()])),
    );
    await renderRoute('/get-started');
    const step = await stepCard(TITLE);

    const alert = await step.findByRole('alert');
    expect(alert.textContent).toContain('Your repositories could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(step.getByRole('button', { name: 'Try again' }));

    expect(await step.findByText('acme/web-app')).toBeTruthy();
  });

  it('shows a skeleton line while the repositories load', async () => {
    answerSetup();
    answerProcedure('repository/list', neverAnswers);

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByRole('status', { name: 'Loading your repositories' })).toBeTruthy();
  });
});

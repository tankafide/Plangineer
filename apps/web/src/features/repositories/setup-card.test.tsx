import type { RepositoryDetail } from '@plangineer/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  page,
  REPOSITORY_ID,
  repositoryFixture,
  rpcError,
  RUN_ID,
  runnerFixture,
  scanFixture,
  setupFixture,
} from '@/test/fixtures';
import { SetupCard } from './setup-card';

const PULL_REQUEST = { number: 12, url: 'https://github.com/acme/web-app/pull/12' };

function renderCard(repository: RepositoryDetail, isAdmin = true) {
  answerProcedure('runner/list', answerJson(page([runnerFixture()])));
  return renderPage(() => <SetupCard repository={repository} isAdmin={isAdmin} />);
}

function withSetup(overrides: Parameters<typeof setupFixture>[0]) {
  return repositoryFixture({ setup: setupFixture(overrides) });
}

function buttonNames(): string[] {
  return screen.getAllByRole('button').map((button) => button.textContent);
}

async function chooseRunner() {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Runner' }));
  await userEvent.click(await screen.findByRole('option', { name: 'ada-laptop' }));
}

describe('SetupCard', () => {
  it('shows Not scanned yet and Scan repository before the first scan', async () => {
    await renderCard(repositoryFixture());

    expect(await screen.findByText('Not scanned yet')).toBeTruthy();
    expect(buttonNames()).toEqual(['Scan repository']);
  });

  it('shows the scan commit, time and instruction files with Generate and Scan again', async () => {
    await renderCard(withSetup({ status: 'scanned' }));

    expect(await screen.findByText(/Scanned .+ at/)).toBeTruthy();
    expect(screen.getByText('0123456')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Instruction files' }).textContent).toBe(
      'AGENTS.mdCLAUDE.md',
    );
    expect(screen.getByRole('group', { name: 'Skills to add' })).toBeTruthy();
    expect(buttonNames()).toContain('Generate pull request');
    expect(buttonNames()).toContain('Scan again');
  });

  it('shows the run status and links to the run for the admin who started it', async () => {
    await renderCard(
      withSetup({
        status: 'generating',
        run: { id: RUN_ID, status: 'running', startedByViewer: true },
      }),
    );

    expect(await screen.findByText('Running')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View run' }).getAttribute('href')).toBe(
      `/runs/${RUN_ID}`,
    );
    expect(buttonNames()).toEqual(['Check status']);
  });

  it('shows only the run status to anyone who did not start the run', async () => {
    await renderCard(
      withSetup({
        status: 'generating',
        run: { id: RUN_ID, status: 'queued', startedByViewer: false },
      }),
    );

    expect(await screen.findByText('Queued')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View run' })).toBeNull();
  });

  it('links to the open pull request with Check pull request and Scan again', async () => {
    await renderCard(withSetup({ status: 'pr_open', pullRequest: PULL_REQUEST }));

    const link = await screen.findByRole('link', { name: 'Pull request #12' });
    expect(link.getAttribute('href')).toBe(PULL_REQUEST.url);
    expect(screen.getByText('Pull request open')).toBeTruthy();
    expect(buttonNames()).toEqual(['Check pull request', 'Scan again']);
  });

  it('shows Setup complete and the pull request with Scan again', async () => {
    await renderCard(withSetup({ status: 'complete', pullRequest: PULL_REQUEST }));

    expect(await screen.findByText('Setup complete')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pull request #12' })).toBeTruthy();
    expect(buttonNames()).toEqual(['Scan again']);
  });

  it('shows the failure message with Generate pull request and Scan again', async () => {
    await renderCard(withSetup({ status: 'failed', failureMessage: 'The push was rejected.' }));

    expect(await screen.findByText('The push was rejected.')).toBeTruthy();
    expect(buttonNames()).toContain('Generate pull request');
    expect(buttonNames()).toContain('Scan again');
  });

  it.each([
    ['none', repositoryFixture()],
    ['scanned', withSetup({ status: 'scanned' })],
    ['generating', withSetup({ status: 'generating', run: null })],
    ['pr_open', withSetup({ status: 'pr_open', pullRequest: PULL_REQUEST })],
    ['complete', withSetup({ status: 'complete', pullRequest: PULL_REQUEST })],
    ['failed', withSetup({ status: 'failed', failureMessage: 'Failed.' })],
  ])(
    'shows a member no buttons or checklists when the setup is %s',
    async (_status, repository) => {
      await renderCard(repository, false);

      expect(await screen.findByRole('heading', { name: 'Setup' })).toBeTruthy();
      expect(screen.queryAllByRole('button')).toEqual([]);
      expect(screen.queryAllByRole('checkbox')).toEqual([]);
    },
  );

  it('lists unmovable content in place of the checklists and disables Generate', async () => {
    await renderCard(
      withSetup({ scan: scanFixture({ unmovableContent: ['.claude/skills/notes.md'] }) }),
    );

    const paths = await screen.findByRole('list', { name: 'Files setup cannot move' });
    expect(paths.textContent).toBe('.claude/skills/notes.md');
    expect(screen.getByText('Move or delete these files, then scan again')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Generate pull request' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the reason and names of an INVALID_SELECTION response', async () => {
    answerProcedure('repositorySetup/start', () =>
      Response.json(
        {
          json: {
            defined: true,
            code: 'INVALID_SELECTION',
            status: 422,
            message: 'Invalid selection',
            data: { reason: 'skill_exists', names: ['frontend-react'] },
          },
          meta: [],
        },
        { status: 422 },
      ),
    );
    await renderCard(withSetup({ status: 'scanned' }));
    await chooseRunner();

    await userEvent.click(screen.getByRole('button', { name: 'Generate pull request' }));

    const alert = await screen.findByText(
      'These skills are already in the repository. Scan again.',
    );
    expect(alert).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Names' }).textContent).toBe('frontend-react');
  });

  it('shows any other start failure under Generate pull request', async () => {
    answerProcedure('repositorySetup/start', rpcError('CONFLICT', 409, 'Setup is generating'));
    await renderCard(withSetup({ status: 'scanned' }));
    await chooseRunner();

    await userEvent.click(screen.getByRole('button', { name: 'Generate pull request' }));

    expect(await screen.findByText('Setup is generating')).toBeTruthy();
  });

  it('asks for a runner before generating', async () => {
    const starts = answerProcedure('repositorySetup/start', answerJson(repositoryFixture()));
    await renderCard(withSetup({ status: 'scanned' }));
    await screen.findByRole('combobox', { name: 'Runner' });

    await userEvent.click(screen.getByRole('button', { name: 'Generate pull request' }));

    expect(await screen.findByText('Choose a runner.')).toBeTruthy();
    expect(starts).toEqual([]);
  });

  it('scans the repository with Scan repository, and shows a scan failure under it', async () => {
    const scans = answerProcedure(
      'repositorySetup/scan',
      rpcError('GITHUB_FAILED', 502, 'GitHub is down'),
    );
    await renderCard(repositoryFixture());

    await userEvent.click(await screen.findByRole('button', { name: 'Scan repository' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The repository could not be scanned: GitHub is down',
    );
    expect(scans).toEqual([{ repositoryId: REPOSITORY_ID }]);
  });

  it('checks the pull request with Check pull request', async () => {
    const refreshes = answerProcedure('repositorySetup/refresh', answerJson(repositoryFixture()));
    await renderCard(withSetup({ status: 'pr_open', pullRequest: PULL_REQUEST }));

    await userEvent.click(await screen.findByRole('button', { name: 'Check pull request' }));

    await waitFor(() => expect(refreshes).toEqual([{ repositoryId: REPOSITORY_ID }]));
  });
});

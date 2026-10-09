import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  neverAnswers,
  page,
  rpcError,
  runnerFixture,
} from '@/test/fixtures';
import { answerSetup, isPrimary, signedOut, stepCard } from '@/test/get-started';

const TITLE = 'Claude Code';
const DESKTOP_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0 Plangineer-Desktop/0.1.0';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClaudeCodeStep', () => {
  it('says the runner is connecting in the desktop app, with no button', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_AGENT);
    answerSetup({ runners: [] });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText("Connecting this computer's runner.")).toBeTruthy();
    expect(step.queryByRole('button')).toBeNull();
  });

  it('shows the Add runner command in a browser, with its copy button primary', async () => {
    answerSetup({ runners: [] });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    const command = `npx plangineer-runner login --server ${window.location.origin}`;
    expect(await step.findByText(command)).toBeTruthy();
    expect(isPrimary(step.getByRole('button', { name: 'Copy command' }))).toBe(true);
  });

  it('asks to install Claude Code on the online runner, as the primary button', async () => {
    answerSetup({
      runners: [
        runnerFixture({
          clis: [
            { name: 'claude-code', version: null, available: false, minimumVersion: '2.1.284' },
          ],
        }),
      ],
      repositories: [],
    });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText(/Install Claude Code on ada-laptop, then run/)).toBeTruthy();
    const link = step.getByRole('link', { name: 'Install Claude Code' });
    expect(link.getAttribute('href')).toBe('https://code.claude.com/docs/en/setup');
    expect(isPrimary(link)).toBe(true);
    const repositoryStep = await stepCard('Add a repository');
    const addRepository = await repositoryStep.findByRole('link', { name: 'Add repository' });
    expect(isPrimary(addRepository)).toBe(false);
  });

  it('asks the desktop app to be reopened after installing, so its runner sees the new PATH', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_AGENT);
    answerSetup({
      runners: [
        runnerFixture({
          clis: [
            { name: 'claude-code', version: null, available: false, minimumVersion: '2.1.284' },
          ],
        }),
      ],
    });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(
      await step.findByText(/Then quit Plangineer from its tray icon and open it again\./),
    ).toBeTruthy();
  });

  it('names the version and the runner once Claude Code is available', async () => {
    answerSetup();

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('Claude Code 2.1.290 on ada-laptop.')).toBeTruthy();
    expect(step.getByText('Done')).toBeTruthy();
  });

  it('names the most recently seen runner as offline, ignoring revoked runners', async () => {
    answerSetup({
      runners: [
        runnerFixture({ online: false, lastSeenAt: '2026-10-07T10:00:00.000Z' }),
        runnerFixture({
          id: '0199c1a2-0000-7d4e-8f90-a1b2c3d4e5f6',
          name: 'build-box',
          online: false,
          lastSeenAt: '2026-10-07T12:00:00.000Z',
        }),
        runnerFixture({
          id: '0199c1a2-1111-7d4e-8f90-a1b2c3d4e5f6',
          name: 'old-box',
          status: 'revoked',
          online: false,
          lastSeenAt: '2026-10-07T13:00:00.000Z',
          revokedAt: '2026-10-07T13:00:00.000Z',
        }),
      ],
    });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('build-box is offline.')).toBeTruthy();
    expect(step.getByText('Not done')).toBeTruthy();
  });

  it('waits for sign-in with no button', async () => {
    answerSetup({ session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByText('Check Claude Code once you sign in.')).toBeTruthy();
    expect(step.queryByRole('button')).toBeNull();
  });

  it('shows a failed line with Try again when the runners fail, and recovers', async () => {
    answerSetup();
    answerProcedure(
      'runner/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([runnerFixture()])),
    );
    await renderRoute('/get-started');
    const step = await stepCard(TITLE);

    const alert = await step.findByRole('alert');
    expect(alert.textContent).toContain('Your runners could not be loaded');
    expect(alert.textContent).toContain('Database down');
    await userEvent.click(step.getByRole('button', { name: 'Try again' }));

    expect(await step.findByText('Claude Code 2.1.290 on ada-laptop.')).toBeTruthy();
  });

  it('shows a skeleton line while the runners load', async () => {
    answerSetup();
    answerProcedure('runner/list', neverAnswers);

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(await step.findByRole('status', { name: 'Loading your runners' })).toBeTruthy();
  });
});

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { execa } from 'execa';
import { SESSION_STATE } from './session-state.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const RUNNER_CLI = path.join(REPO_ROOT, 'apps', 'runner', 'src', 'cli.ts');
const FAKE_AGENT = path.join(
  REPO_ROOT,
  'apps',
  'runner',
  'src',
  'adapters',
  'claude-code',
  'fake-claude.ts',
);
const IDENTITY = ['-c', 'user.name=Plangineer Test', '-c', 'user.email=test@example.com'];
const SKILL = '---\nname: e2e\ndescription: A skill for the e2e journey.\n---\n\n# E2E\n';

test.use({ storageState: SESSION_STATE });

/** A temporary folder holding a bare `acme/app` remote with one commit and a synced skills mirror. */
async function createRemote(root: string): Promise<string> {
  const remote = path.join(root, 'remote');
  const bare = path.join(remote, 'acme', 'app.git');
  const work = path.join(root, 'work');
  await mkdir(bare, { recursive: true });
  await execa('git', ['init', '--quiet', '--bare', '--initial-branch=main'], { cwd: bare });
  await mkdir(work);
  await execa('git', ['init', '--quiet', '--initial-branch=main'], { cwd: work });
  for (const dir of ['.agents', '.claude']) {
    await mkdir(path.join(work, dir, 'skills', 'e2e'), { recursive: true });
    await writeFile(path.join(work, dir, 'skills', 'e2e', 'SKILL.md'), SKILL);
  }
  await writeFile(path.join(work, 'README.md'), '# App\n');
  await execa('git', ['add', '--all'], { cwd: work });
  await execa('git', [...IDENTITY, 'commit', '--quiet', '-m', 'Initial commit'], { cwd: work });
  await execa('git', ['push', '--quiet', bare, 'main'], { cwd: work });
  return pathToFileURL(remote).href;
}

interface RunningRunner {
  stop: () => Promise<void>;
}

/** Starts the runner, returning how to stop it and wait for it to exit. */
function spawnRunner(env: Record<string, string>): RunningRunner {
  const subprocess = execa(process.execPath, [RUNNER_CLI, 'start'], { env, reject: false });
  return {
    stop: async () => {
      subprocess.kill();
      await subprocess;
    },
  };
}

/** Pairs a runner through the Runners screen and starts it with the fake agent. */
async function startRunner(page: Page, root: string, name: string): Promise<RunningRunner> {
  const env = {
    PLANGINEER_RUNNER_DATA_DIR: path.join(root, 'runner'),
    PLANGINEER_GIT_BASE_URL: await createRemote(root),
    PLANGINEER_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_AGENT]),
  };
  await page.goto('/runners');
  await page.getByRole('button', { name: 'Pair a runner' }).click();
  const command = await page.getByText('pnpm runner pair --server').textContent();
  const [, server, code] = /--server (\S+) --code (\S+)/.exec(command ?? '') ?? [];
  if (server === undefined || code === undefined) throw new Error('No pairing command shown');
  await execa(
    process.execPath,
    [RUNNER_CLI, 'pair', '--server', server, '--code', code, '--name', name],
    {
      env,
    },
  );
  return spawnRunner(env);
}

async function startRun(page: Page, runnerName: string, prompt: string): Promise<void> {
  await page.goto('/runs');
  await page.getByRole('combobox', { name: 'Runner' }).click();
  await page.getByRole('option', { name: runnerName }).click();
  await page.getByLabel('Repository').fill('acme/app');
  await page.getByLabel('Ref').fill('main');
  await page.getByLabel('Prompt').fill(prompt);
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
}

async function revokeRunner(page: Page, name: string): Promise<void> {
  await page.goto('/runners');
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name }) });
  await card.getByRole('button', { name: 'Revoke' }).click();
  await card.getByRole('button', { name: 'Revoke runner' }).click();
  await expect(card.getByText('Revoked').first()).toBeVisible();
}

test.describe('a test run on a paired runner', () => {
  let root: string;
  let runnerName: string;
  let runner: RunningRunner;

  test.beforeEach(async ({ page }, testInfo) => {
    root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-e2e-'));
    runnerName = `e2e-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    runner = await startRunner(page, root, runnerName);
  });

  test.afterEach(async ({ page }) => {
    await runner.stop();
    await revokeRunner(page, runnerName);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('streams its events until Succeeded', async ({ page }) => {
    await startRun(page, runnerName, 'List the files in this folder and name one.');

    await expect(page.getByRole('list', { name: 'Run events' })).toContainText('Glob');
    await expect(page.getByText('Succeeded').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  });

  test('cancels a hanging run', async ({ page }) => {
    await startRun(page, runnerName, 'fake:hang');
    await expect(page.getByText('Running').first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancel run' }).click();
    await page.getByRole('button', { name: 'Cancel run' }).click();

    await expect(page.getByText('Cancelled').first()).toBeVisible();
  });
});

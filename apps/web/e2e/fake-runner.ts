import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { execa } from 'execa';

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
const SKILLS = {
  e2e: '---\nname: e2e\ndescription: A skill for the e2e journey.\n---\n\n# E2E\n',
  'codebase-exploration':
    '---\nname: codebase-exploration\ndescription: Explores the codebase for a brief.\n---\n\n# Codebase exploration\n',
};

/**
 * A temporary folder holding a bare `acme/app` remote on `main` with a synced skills mirror,
 * including the codebase-exploration skill an exploration task needs.
 */
async function createRemote(root: string): Promise<string> {
  const remote = path.join(root, 'remote');
  const bare = path.join(remote, 'acme', 'app.git');
  const work = path.join(root, 'work');
  await mkdir(bare, { recursive: true });
  await execa('git', ['init', '--quiet', '--bare', '--initial-branch=main'], { cwd: bare });
  await mkdir(work);
  await execa('git', ['init', '--quiet', '--initial-branch=main'], { cwd: work });
  for (const dir of ['.agents', '.claude']) {
    for (const [name, content] of Object.entries(SKILLS)) {
      await mkdir(path.join(work, dir, 'skills', name), { recursive: true });
      await writeFile(path.join(work, dir, 'skills', name, 'SKILL.md'), content);
    }
  }
  await writeFile(path.join(work, 'README.md'), '# App\n');
  await execa('git', ['add', '--all'], { cwd: work });
  await execa('git', [...IDENTITY, 'commit', '--quiet', '-m', 'Initial commit'], { cwd: work });
  await execa('git', ['push', '--quiet', bare, 'main'], { cwd: work });
  return pathToFileURL(remote).href;
}

export interface RunningRunner {
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

/**
 * Reads the stdout lines until the approval link appears. Reading stays attached afterwards,
 * so the process is never cut off the way leaving an execa iterable early would.
 */
function readApprovalLink(stdout: Readable): Promise<string> {
  const printed: string[] = [];
  const lines = createInterface({ input: stdout });
  return new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      printed.push(line);
      const link = /approve it in Plangineer: (\S+)$/.exec(line)?.[1];
      if (link !== undefined) resolve(link);
    });
    lines.on('close', () =>
      reject(
        new Error(`The login ended before it printed an approval link: ${printed.join(' | ')}`),
      ),
    );
  });
}

/** Pairs a runner through the approval page and starts it with the fake agent. */
export async function startRunner(
  page: Page,
  baseURL: string,
  root: string,
  name: string,
): Promise<RunningRunner> {
  const env = {
    PLANGINEER_RUNNER_DATA_DIR: path.join(root, 'runner'),
    PLANGINEER_GIT_BASE_URL: await createRemote(root),
    PLANGINEER_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_AGENT]),
  };
  const login = execa(
    process.execPath,
    [RUNNER_CLI, 'login', '--server', baseURL, '--name', name, '--no-browser'],
    { env },
  );
  await page.goto(await readApprovalLink(login.stdout));
  await expect(page.getByRole('heading', { name: `Pair ${name}?` })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(
    page.getByText('Approved. Your terminal finishes pairing on its own.'),
  ).toBeVisible();
  await login;
  return spawnRunner(env);
}

/** Revokes a runner a journey paired, so no later journey sends work to it. */
export async function revokeRunner(page: Page, name: string): Promise<void> {
  await page.goto('/runners');
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name }) });
  await card.getByRole('button', { name: 'Revoke' }).click();
  await card.getByRole('button', { name: 'Revoke runner' }).click();
  await expect(card.getByText('Revoked').first()).toBeVisible();
}

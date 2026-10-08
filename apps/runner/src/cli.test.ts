import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FAKE_CLAUDE_COMMAND, isProcessRunning } from './test/fake-agent.ts';
import { startFakeControlPlane } from './test/fake-control-plane.ts';
import { createGitRemote, SYNCED_SKILLS } from './test/git-remote.ts';
import {
  isMessage,
  removeDataDir,
  TEST_REPOSITORY,
  testJob,
  testRunnerEnv,
  waitForFakePids,
} from './test/test-runner.ts';

const cliPath = fileURLToPath(new URL('cli.ts', import.meta.url));
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'plangineer-runner-'));
});

afterAll(() => rm(cwd, { recursive: true, force: true, maxRetries: 5 }));

function cli(args: string[], env: Record<string, string> = {}) {
  return execa(process.execPath, [cliPath, ...args], { cwd, env, reject: false });
}

describe('plangineer-runner CLI', () => {
  it('prints the package version for --version', async () => {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));

    const result = await cli(['--version']);

    expect(result.exitCode).toBe(0);
    expect(manifest).toHaveProperty('version', result.stdout);
  });

  it.each([
    [[]],
    [['--help']],
    [['--version', 'extra']],
    [['skills', 'sync', '--staged']],
    [['skills', 'chek']],
    [['skills', 'check', '--extra']],
    [['login']],
    [['login', '--server', 'not a url']],
    [['login', '--server', 'http://localhost', '--bogus']],
    [['pair', '--server', 'http://localhost', '--code', 'ABCD-EFGH-JKMN']],
    [['start', 'now']],
  ])('prints the usage and exits 1 for arguments %j', async (args) => {
    const result = await cli(args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^Usage: plangineer-runner <command>/);
  });

  it('syncs and checks the skills mirror of the current directory', async () => {
    await mkdir(path.join(cwd, '.agents', 'skills', 'alpha'), { recursive: true });
    await writeFile(path.join(cwd, '.agents', 'skills', 'alpha', 'SKILL.md'), 'alpha\n');

    const before = await cli(['skills', 'check']);
    const sync = await cli(['skills', 'sync']);
    const after = await cli(['skills', 'check']);

    expect(before.exitCode).toBe(1);
    expect(before.stderr).toContain('missing: .claude/skills/alpha/SKILL.md');
    expect(sync.stdout).toBe('Skills mirror synced: 1 written, 0 removed.');
    expect(after).toMatchObject({ exitCode: 0, stdout: 'Skills mirror is in sync.' });
  });

  it.each([
    ['PLANGINEER_RUNNER_CONCURRENCY', '0'],
    ['PLANGINEER_CLAUDE_COMMAND', 'claude'],
  ])('exits 1 naming %s when it is %s', async (name, value) => {
    const result = await cli(['start'], { [name]: value });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Invalid environment:\n  ${name}:`);
  });
});

describe('plangineer-runner start', () => {
  // Windows cannot deliver a catchable SIGINT from another process, so this case runs only on
  // macOS and Linux. The in-process shutdown test in start-command.test.ts covers all three.
  it.skipIf(process.platform === 'win32')(
    'fails the running job with runner_stopped and stops the agent on SIGINT',
    async () => {
      const remote = await createGitRemote(TEST_REPOSITORY);
      await remote.commit(SYNCED_SKILLS);
      const plane = await startFakeControlPlane();
      const env = await testRunnerEnv({ plane, gitBaseUrl: remote.baseUrl });
      const child = execa(process.execPath, [cliPath, 'start'], {
        reject: false,
        env: {
          PLANGINEER_RUNNER_DATA_DIR: env.PLANGINEER_RUNNER_DATA_DIR,
          PLANGINEER_CLAUDE_COMMAND: JSON.stringify(FAKE_CLAUDE_COMMAND),
          PLANGINEER_GIT_BASE_URL: remote.baseUrl,
          LOG_LEVEL: 'error',
        },
      });
      await plane.waitFor(isMessage('hello'));
      const runId = plane.assign(testJob('fake:hang'));
      const pids = await waitForFakePids(plane, runId);

      child.kill('SIGINT');
      const result = await child;

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split(/\r?\n/).at(-1)).toBe('Runner stopped.');
      expect(plane.events(runId).at(-1)?.event).toMatchObject({ reason: 'runner_stopped' });
      await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
      await plane.stop();
      await removeDataDir(env);
      await remote.cleanup();
    },
  );
});

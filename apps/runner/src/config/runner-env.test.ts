import path from 'node:path';
import envPaths from 'env-paths';
import { describe, expect, it } from 'vitest';
import { parseRunnerEnv } from './runner-env.ts';

const dataDir = path.resolve('runner-data');

describe('parseRunnerEnv', () => {
  it('gives each absent variable its one meaning', () => {
    expect(parseRunnerEnv({})).toEqual({
      ok: true,
      env: {
        PLANGINEER_RUNNER_DATA_DIR: envPaths('plangineer-runner', { suffix: '' }).data,
        PLANGINEER_RUNNER_CONCURRENCY: 2,
        PLANGINEER_CLAUDE_COMMAND: ['claude'],
        PLANGINEER_GIT_BASE_URL: 'https://github.com',
        PLANGINEER_RUN_TIMEOUT_MS: 3_600_000,
        LOG_LEVEL: 'info',
      },
    });
  });

  it('parses every variable when set', () => {
    expect(
      parseRunnerEnv({
        PLANGINEER_RUNNER_DATA_DIR: dataDir,
        PLANGINEER_RUNNER_CONCURRENCY: '16',
        PLANGINEER_CLAUDE_COMMAND: '["node","fake-claude.ts"]',
        PLANGINEER_GIT_BASE_URL: 'file:///srv/git/',
        PLANGINEER_RUN_TIMEOUT_MS: '1000',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      ok: true,
      env: {
        PLANGINEER_RUNNER_DATA_DIR: dataDir,
        PLANGINEER_RUNNER_CONCURRENCY: 16,
        PLANGINEER_CLAUDE_COMMAND: ['node', 'fake-claude.ts'],
        PLANGINEER_GIT_BASE_URL: 'file:///srv/git',
        PLANGINEER_RUN_TIMEOUT_MS: 1000,
        LOG_LEVEL: 'debug',
      },
    });
  });

  it.each([
    ['PLANGINEER_RUNNER_CONCURRENCY', '0'],
    ['PLANGINEER_RUNNER_CONCURRENCY', '17'],
    ['PLANGINEER_RUNNER_CONCURRENCY', 'two'],
    ['PLANGINEER_CLAUDE_COMMAND', 'claude'],
    ['PLANGINEER_CLAUDE_COMMAND', '{"command":"claude"}'],
    ['PLANGINEER_CLAUDE_COMMAND', '[]'],
    ['PLANGINEER_CLAUDE_COMMAND', '[""]'],
    ['PLANGINEER_CLAUDE_COMMAND', JSON.stringify(Array.from({ length: 11 }, () => 'a'))],
    ['PLANGINEER_RUNNER_DATA_DIR', 'relative/dir'],
    ['PLANGINEER_GIT_BASE_URL', 'http://github.com'],
    ['PLANGINEER_RUN_TIMEOUT_MS', '999'],
    ['PLANGINEER_RUN_TIMEOUT_MS', '86400001'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s, naming the variable', (name, value) => {
    expect(parseRunnerEnv({ [name]: value })).toEqual({
      ok: false,
      message: expect.stringContaining(name),
    });
  });
});

import { describe, expect, it } from 'vitest';
import { childEnv } from './child-env.ts';

describe('childEnv', () => {
  it('passes the allowlist and drops the runner and unlisted variables', () => {
    const env = childEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CONFIG_DIR: '/config',
      PLANGINEER_RUNNER_DATA_DIR: '/data',
      DATABASE_URL: 'postgres://secret',
    });

    expect(env).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CONFIG_DIR: '/config',
    });
  });

  it('matches names case-insensitively and keeps each original key', () => {
    expect(childEnv({ Path: 'C:\\Windows', http_proxy: 'http://proxy', LC_ALL: 'C' })).toEqual({
      Path: 'C:\\Windows',
      http_proxy: 'http://proxy',
      LC_ALL: 'C',
    });
  });

  it('drops variables with no value', () => {
    expect(childEnv({ HOME: undefined })).toEqual({});
  });
});

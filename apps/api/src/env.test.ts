import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

function source(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgres://plangineer:plangineer@localhost:5432/plangineer',
    API_PORT: '3000',
    LOG_LEVEL: 'info',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:5173',
    GITHUB_APP_CLIENT_ID: 'client-id',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
    ...overrides,
  };
}

describe('parseEnv', () => {
  it('returns typed values for a valid source', () => {
    expect(parseEnv(source())).toEqual({ ...source(), API_PORT: 3000 });
  });

  it('ignores variables outside the schema', () => {
    expect(parseEnv(source({ PATH: '/usr/bin' }))).not.toHaveProperty('PATH');
  });

  it('names every missing or invalid variable in one error', () => {
    const bad = source({
      DATABASE_URL: undefined,
      API_PORT: '3000.5',
      LOG_LEVEL: 'loud',
      BETTER_AUTH_SECRET: 'short',
      BETTER_AUTH_URL: 'not a url',
    });

    expect(() => parseEnv(bad)).toThrow(
      /DATABASE_URL[\s\S]*API_PORT[\s\S]*LOG_LEVEL[\s\S]*BETTER_AUTH_SECRET[\s\S]*BETTER_AUTH_URL/,
    );
  });

  it.each(['0', '65536', '-1', ' 3000', ''])('rejects the port %j', (API_PORT) => {
    expect(() => parseEnv(source({ API_PORT }))).toThrow('API_PORT');
  });

  it.each(['1', '65535'])('accepts the port %s', (API_PORT) => {
    expect(parseEnv(source({ API_PORT })).API_PORT).toBe(Number(API_PORT));
  });
});

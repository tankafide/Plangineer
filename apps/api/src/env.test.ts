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
    RUNNER_HEARTBEAT_INTERVAL_MS: '10000',
    RUN_LEASE_DURATION_MS: '30000',
    RUNNER_OFFLINE_AFTER_MS: '30000',
    RUN_SWEEP_INTERVAL_MS: '5000',
    RUN_MAX_ATTEMPTS: '3',
    SSE_KEEPALIVE_INTERVAL_MS: '15000',
    RUNNER_PAIRING_CODE_TTL_MS: '600000',
    ...overrides,
  };
}

describe('parseEnv', () => {
  it('returns typed values for a valid source', () => {
    expect(parseEnv(source())).toEqual({
      ...source(),
      API_PORT: 3000,
      RUNNER_HEARTBEAT_INTERVAL_MS: 10_000,
      RUN_LEASE_DURATION_MS: 30_000,
      RUNNER_OFFLINE_AFTER_MS: 30_000,
      RUN_SWEEP_INTERVAL_MS: 5_000,
      RUN_MAX_ATTEMPTS: 3,
      SSE_KEEPALIVE_INTERVAL_MS: 15_000,
      RUNNER_PAIRING_CODE_TTL_MS: 600_000,
    });
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

  const RUN_VARIABLES = [
    'RUNNER_HEARTBEAT_INTERVAL_MS',
    'RUN_LEASE_DURATION_MS',
    'RUNNER_OFFLINE_AFTER_MS',
    'RUN_SWEEP_INTERVAL_MS',
    'RUN_MAX_ATTEMPTS',
    'SSE_KEEPALIVE_INTERVAL_MS',
    'RUNNER_PAIRING_CODE_TTL_MS',
  ];

  it.each(RUN_VARIABLES)('names %s when it is missing', (name) => {
    expect(() => parseEnv(source({ [name]: undefined }))).toThrow(name);
  });

  it.each([
    ['RUNNER_HEARTBEAT_INTERVAL_MS', '999'],
    ['RUNNER_HEARTBEAT_INTERVAL_MS', '60001'],
    ['RUN_SWEEP_INTERVAL_MS', '999'],
    ['RUN_SWEEP_INTERVAL_MS', '60001'],
    ['RUN_MAX_ATTEMPTS', '0'],
    ['RUN_MAX_ATTEMPTS', '11'],
    ['SSE_KEEPALIVE_INTERVAL_MS', '60001'],
    ['RUNNER_PAIRING_CODE_TTL_MS', '59999'],
    ['RUNNER_PAIRING_CODE_TTL_MS', '3600001'],
    ['RUN_LEASE_DURATION_MS', '1.5'],
  ])('names %s when it is %s', (name, value) => {
    expect(() => parseEnv(source({ [name]: value }))).toThrow(name);
  });

  it.each(['RUN_LEASE_DURATION_MS', 'RUNNER_OFFLINE_AFTER_MS'])(
    'names %s when it is under 3 heartbeat intervals',
    (name) => {
      expect(() => parseEnv(source({ [name]: '29999' }))).toThrow(
        `${name}: must be at least 3 times RUNNER_HEARTBEAT_INTERVAL_MS`,
      );
    },
  );

  it('accepts a lease of exactly 3 heartbeat intervals', () => {
    expect(parseEnv(source({ RUN_LEASE_DURATION_MS: '30000' })).RUN_LEASE_DURATION_MS).toBe(30_000);
  });
});

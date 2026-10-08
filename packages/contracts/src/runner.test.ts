import { describe, expect, it } from 'vitest';
import {
  Runner,
  RunnerCreatePairingCodeOutput,
  RunnerPairInput,
  RunnerPairOutput,
  RunnerRevokeInput,
} from './runner.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';

function runner(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: 'workstation',
    platform: 'win32',
    status: 'active',
    online: true,
    lastSeenAt: AT,
    planLimitResetsAt: null,
    concurrencyLimit: 2,
    clis: [{ name: 'claude-code', version: '2.1.284', available: true, minimumVersion: '2.1.284' }],
    createdAt: AT,
    revokedAt: null,
    ...overrides,
  };
}

function pairInput(overrides: Record<string, unknown> = {}) {
  return { code: 'ABCD-EFGH-JKMN', name: 'workstation', platform: 'linux', ...overrides };
}

describe('Runner', () => {
  it('accepts a runner', () => {
    expect(Runner.parse(runner())).toEqual(runner());
  });

  it.each([
    ['platform', 'aix'],
    ['status', 'paused'],
    ['lastSeenAt', '2026-10-07T12:00:00+02:00'],
    ['concurrencyLimit', 1.5],
  ])('rejects an invalid %s', (key, value) => {
    expect(Runner.safeParse(runner({ [key]: value })).success).toBe(false);
  });

  it('strips an unknown key, such as a token hash', () => {
    expect(Runner.parse(runner({ tokenHash: 'abc' }))).toEqual(runner());
  });

  it('has no token or hash field', () => {
    expect(Object.keys(Runner.shape).filter((key) => /token|hash/i.test(key))).toEqual([]);
  });
});

describe('RunnerPairInput', () => {
  it.each(['ABCD-EFGH-JKMN', 'abcdefghjkmn', 'ABCDEFGH-JKMN'])('accepts the code %s', (code) => {
    expect(RunnerPairInput.safeParse(pairInput({ code })).success).toBe(true);
  });

  it.each(['ABCD-EFGH-JKM', 'ABCD_EFGH_JKMN', 'ABCD-EFGH-JKMN-'])('rejects the code %s', (code) => {
    expect(RunnerPairInput.safeParse(pairInput({ code })).success).toBe(false);
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(101)],
    ['platform', 'freebsd'],
  ])('rejects an invalid %s', (key, value) => {
    expect(RunnerPairInput.safeParse(pairInput({ [key]: value })).success).toBe(false);
  });

  it('accepts a name of 100 characters', () => {
    expect(RunnerPairInput.safeParse(pairInput({ name: 'x'.repeat(100) })).success).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(RunnerPairInput.safeParse(pairInput({ token: 'x' })).success).toBe(false);
  });
});

describe('RunnerRevokeInput', () => {
  it('rejects a runner id that is not a uuid', () => {
    expect(RunnerRevokeInput.safeParse({ runnerId: 'runner-1' }).success).toBe(false);
  });
});

describe('runner outputs', () => {
  it('strip an unknown key', () => {
    expect(RunnerPairOutput.parse({ runnerId: ID, token: 't', tokenHash: 'h' })).toEqual({
      runnerId: ID,
      token: 't',
    });
    expect(
      RunnerCreatePairingCodeOutput.parse({ code: 'ABCD-EFGH-JKMN', expiresAt: AT, codeHash: 'h' }),
    ).toEqual({ code: 'ABCD-EFGH-JKMN', expiresAt: AT });
  });

  it('have no hash field', () => {
    const keys = [
      ...Object.keys(RunnerPairOutput.shape),
      ...Object.keys(RunnerCreatePairingCodeOutput.shape),
    ];
    expect(keys.filter((key) => /hash/i.test(key))).toEqual([]);
  });
});

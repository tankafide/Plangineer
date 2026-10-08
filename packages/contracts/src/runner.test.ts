import { describe, expect, it } from 'vitest';
import {
  Runner,
  RunnerLogin,
  RunnerPollLoginInput,
  RunnerPollLoginOutput,
  RunnerRevokeInput,
  RunnerStartLoginInput,
  RunnerStartLoginOutput,
  RunnerUserCodeInput,
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

const DEVICE_SECRET = 'A'.repeat(43);

function startInput(overrides: Record<string, unknown> = {}) {
  return { name: 'workstation', platform: 'linux', ...overrides };
}

function login(overrides: Record<string, unknown> = {}) {
  return {
    name: 'workstation',
    platform: 'linux',
    status: 'pending',
    requestedAt: AT,
    expiresAt: AT,
    ...overrides,
  };
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

describe('RunnerStartLoginInput', () => {
  it('accepts a valid input, and a name of 100 characters', () => {
    expect(RunnerStartLoginInput.safeParse(startInput()).success).toBe(true);
    expect(RunnerStartLoginInput.safeParse(startInput({ name: 'x'.repeat(100) })).success).toBe(
      true,
    );
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(101)],
    ['platform', 'freebsd'],
  ])('rejects an invalid %s', (key, value) => {
    expect(RunnerStartLoginInput.safeParse(startInput({ [key]: value })).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(RunnerStartLoginInput.safeParse(startInput({ token: 'x' })).success).toBe(false);
  });
});

describe('RunnerUserCodeInput', () => {
  it.each(['ABCD-EFGH-JKMN', 'abcdefghjkmn', 'ABCDEFGH-JKMN'])(
    'accepts the code %s',
    (userCode) => {
      expect(RunnerUserCodeInput.safeParse({ userCode }).success).toBe(true);
    },
  );

  it.each(['ABCD-EFGH-JKM', 'ABCD_EFGH_JKMN', 'ABCD-EFGH-JKMN-'])(
    'rejects the code %s',
    (userCode) => {
      expect(RunnerUserCodeInput.safeParse({ userCode }).success).toBe(false);
    },
  );

  it('rejects an unknown key', () => {
    expect(RunnerUserCodeInput.safeParse({ userCode: 'ABCD-EFGH-JKMN', x: 1 }).success).toBe(false);
  });
});

describe('RunnerPollLoginInput', () => {
  it('accepts a 43-character base64url device secret', () => {
    expect(RunnerPollLoginInput.safeParse({ deviceSecret: DEVICE_SECRET }).success).toBe(true);
  });

  it.each(['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`])(
    'rejects the device secret %s',
    (deviceSecret) => {
      expect(RunnerPollLoginInput.safeParse({ deviceSecret }).success).toBe(false);
    },
  );

  it('rejects an unknown key', () => {
    expect(RunnerPollLoginInput.safeParse({ deviceSecret: DEVICE_SECRET, x: 1 }).success).toBe(
      false,
    );
  });
});

describe('RunnerRevokeInput', () => {
  it('rejects a runner id that is not a uuid', () => {
    expect(RunnerRevokeInput.safeParse({ runnerId: 'runner-1' }).success).toBe(false);
  });
});

describe('runner login outputs', () => {
  it('strip an unknown key', () => {
    const start = {
      deviceSecret: DEVICE_SECRET,
      userCode: 'ABCD-EFGH-JKMN',
      approveUrl: 'http://localhost:5173/runners/approve?code=ABCD-EFGH-JKMN',
      expiresAt: AT,
      pollIntervalMs: 2000,
    };
    expect(RunnerStartLoginOutput.parse({ ...start, userCodeHash: 'h' })).toEqual(start);
    expect(RunnerLogin.parse({ ...login(), userId: 'u' })).toEqual(login());
  });

  it.each([
    [{ status: 'pending' }],
    [{ status: 'approved', runnerId: ID, token: 't' }],
    [{ status: 'denied' }],
    [{ status: 'expired' }],
  ])('RunnerPollLoginOutput parses %j', (output) => {
    expect(RunnerPollLoginOutput.parse({ ...output, tokenHash: 'h' })).toEqual(output);
  });

  it('RunnerStartLoginOutput rejects an approval link that is not http or https', () => {
    const start = {
      deviceSecret: DEVICE_SECRET,
      userCode: 'ABCD-EFGH-JKMN',
      approveUrl: 'file:///etc/passwd',
      expiresAt: AT,
      pollIntervalMs: 2000,
    };
    expect(RunnerStartLoginOutput.safeParse(start).success).toBe(false);
  });

  it('RunnerPollLoginOutput strips a token from a status that has none', () => {
    expect(RunnerPollLoginOutput.parse({ status: 'denied', token: 't' })).toEqual({
      status: 'denied',
    });
  });

  it('RunnerLogin rejects the status completed', () => {
    expect(RunnerLogin.safeParse(login({ status: 'completed' })).success).toBe(false);
  });
});

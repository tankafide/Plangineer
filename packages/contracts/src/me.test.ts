import { describe, expect, it } from 'vitest';
import { MeGetOutput } from './me.ts';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'member',
    ...overrides,
  };
}

describe('MeGetOutput', () => {
  it.each(['admin', 'member'])('accepts a user with the role %s', (role) => {
    expect(MeGetOutput.parse(user({ role }))).toEqual(user({ role }));
  });

  it('rejects an unknown role', () => {
    expect(MeGetOutput.safeParse(user({ role: 'owner' })).success).toBe(false);
  });

  it('rejects an id that is not a uuid', () => {
    expect(MeGetOutput.safeParse(user({ id: 'user-1' })).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(MeGetOutput.safeParse(user({ email: 'not-an-email' })).success).toBe(false);
  });

  it('strips an unknown key', () => {
    expect(MeGetOutput.parse(user({ passwordHash: 'secret' }))).toEqual(user());
  });
});

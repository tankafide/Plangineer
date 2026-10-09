import { describe, expect, it } from 'vitest';
import { RunnerLoginEvent } from './runner-cli.ts';

describe('RunnerLoginEvent', () => {
  it.each([
    {
      event: 'login_started',
      userCode: 'ABCD-EFGH-JKMN',
      approveUrl: 'http://127.0.0.1:47100/runners/approve?code=ABCD-EFGH-JKMN',
      expiresAt: '2026-10-08T12:00:00.000Z',
    },
    { event: 'paired', runnerId: '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6' },
    { event: 'failed', message: 'The login request was denied.' },
  ])('parses $event', (line) => {
    expect(RunnerLoginEvent.parse(line)).toEqual(line);
  });

  it('rejects an unknown event', () => {
    expect(RunnerLoginEvent.safeParse({ event: 'waiting' }).success).toBe(false);
  });

  it('accepts a 500-character message and rejects a 501-character one', () => {
    expect(RunnerLoginEvent.safeParse({ event: 'failed', message: 'a'.repeat(500) }).success).toBe(
      true,
    );
    expect(RunnerLoginEvent.safeParse({ event: 'failed', message: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { pickRunner } from './runner-choice.ts';

const A = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f1';
const B = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f2';
const C = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f3';
const EARLY = '2026-10-09T10:00:00.000Z';
const LATE = '2026-10-09T11:00:00.000Z';

describe('pickRunner', () => {
  it('picks the non-revoked runner seen most recently', () => {
    expect(
      pickRunner([
        { id: A, status: 'active', lastSeenAt: EARLY },
        { id: B, status: 'revoked', lastSeenAt: LATE },
        { id: C, status: 'active', lastSeenAt: LATE },
      ]),
    ).toBe(C);
  });

  it('puts a runner never seen last', () => {
    expect(
      pickRunner([
        { id: A, status: 'active', lastSeenAt: null },
        { id: B, status: 'active', lastSeenAt: EARLY },
      ]),
    ).toBe(B);
  });

  it('breaks a tie with the lower id', () => {
    expect(
      pickRunner([
        { id: B, status: 'active', lastSeenAt: null },
        { id: A, status: 'active', lastSeenAt: null },
      ]),
    ).toBe(A);
  });

  it('returns null when every runner is revoked', () => {
    expect(pickRunner([{ id: A, status: 'revoked', lastSeenAt: LATE }])).toBeNull();
    expect(pickRunner([])).toBeNull();
  });
});

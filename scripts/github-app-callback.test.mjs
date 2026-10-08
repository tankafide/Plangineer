import { describe, expect, it } from 'vitest';
import { checkCallback } from './github-app-callback.mjs';

const STATE = '0123456789abcdef0123456789abcdef';

describe('checkCallback', () => {
  it('returns the code when the state matches', () => {
    expect(checkCallback(new URLSearchParams({ code: 'abc', state: STATE }), STATE)).toEqual({
      ok: true,
      code: 'abc',
    });
  });

  it.each([
    ['a wrong state', { code: 'abc', state: 'f'.repeat(32) }],
    ['a state of another length', { code: 'abc', state: 'short' }],
    ['no state', { code: 'abc' }],
  ])('rejects %s with status 400', (_, query) => {
    expect(checkCallback(new URLSearchParams(query), STATE)).toEqual({
      ok: false,
      status: 400,
      message: 'The state does not match. Rerun pnpm setup:github-app.',
    });
  });

  it.each([
    ['no code', { state: STATE }],
    ['an empty code', { code: '', state: STATE }],
  ])('rejects %s with status 400', (_, query) => {
    expect(checkCallback(new URLSearchParams(query), STATE)).toEqual({
      ok: false,
      status: 400,
      message: 'GitHub sent no code. Rerun pnpm setup:github-app.',
    });
  });
});

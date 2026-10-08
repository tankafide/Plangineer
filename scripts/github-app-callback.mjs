import { timingSafeEqual } from 'node:crypto';

function sameState(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks GitHub's manifest-flow redirect query against the state the script sent. */
export function checkCallback(query, expectedState) {
  const state = query.get('state');
  if (state === null || !sameState(state, expectedState)) {
    return {
      ok: false,
      status: 400,
      message: 'The state does not match. Rerun pnpm setup:github-app.',
    };
  }
  const code = query.get('code');
  if (code === null || code === '') {
    return { ok: false, status: 400, message: 'GitHub sent no code. Rerun pnpm setup:github-app.' };
  }
  return { ok: true, code };
}

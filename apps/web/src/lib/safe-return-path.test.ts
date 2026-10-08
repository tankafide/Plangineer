import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-return-path';

const ORIGIN = 'http://localhost:5173';

describe('safeReturnPath', () => {
  it.each([
    ['https://example.com'],
    ['//example.com'],
    ['/\\example.com'],
    ['/a\\b'],
    ['/a\tb'],
    ['/a\nb'],
    ['/a\u007fb'],
    ['runners'],
    [''],
  ])('returns / for %j', (value) => {
    expect(safeReturnPath(value, ORIGIN)).toBe('/');
  });

  it.each(['/', '/runs', '/runners/approve?code=ABCD-EFGH-JKMN', '/runs?x=%2F#top'])(
    'returns the same-origin path %s unchanged',
    (value) => {
      expect(safeReturnPath(value, ORIGIN)).toBe(value);
    },
  );
});

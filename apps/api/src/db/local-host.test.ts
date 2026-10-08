import { describe, expect, it } from 'vitest';
import { isLocalDatabaseUrl } from './local-host.ts';

describe('isLocalDatabaseUrl', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('is true for the host %s', (host) => {
    expect(isLocalDatabaseUrl(`postgres://u:p@${host}:5432/plangineer`)).toBe(true);
  });

  it.each(['db.example.com', 'localhost.example.com', '10.0.0.5', '127.0.0.2'])(
    'is false for the host %s',
    (host) => {
      expect(isLocalDatabaseUrl(`postgres://u:p@${host}:5432/plangineer`)).toBe(false);
    },
  );
});

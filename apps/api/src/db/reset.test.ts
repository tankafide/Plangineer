import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { testEnv } from '../test/fixtures.ts';

const RESET_SCRIPT = fileURLToPath(new URL('reset.ts', import.meta.url));

describe('db:reset', () => {
  it('refuses a DATABASE_URL whose host is not local, before connecting', async () => {
    const env = testEnv({
      DATABASE_URL: 'postgres://plangineer:plangineer@db.example.com:5432/plangineer',
    });

    const result = await execa(process.execPath, [RESET_SCRIPT], {
      env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])),
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('db:reset refuses a DATABASE_URL whose host is not local');
  });
});

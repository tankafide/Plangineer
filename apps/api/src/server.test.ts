import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger, testEnv } from './test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from './test/test-database.ts';
import { startServer } from './server.ts';

describe('startServer', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('serves on a free port when API_PORT is 0, and closes cleanly', async () => {
    const server = await startServer({
      env: testEnv({ DATABASE_URL: database.url, API_PORT: 0 }),
      logger: silentLogger,
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/auth/ok`);

    expect(server.port).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${server.port}/api/auth/ok`)).rejects.toThrow(
      'fetch failed',
    );
  });

  it('stops at startup when the stored GitHub App does not decrypt', async () => {
    const start = startServer({
      env: testEnv({
        DATABASE_URL: database.url,
        API_PORT: 0,
        BETTER_AUTH_SECRET: 'another-secret-that-is-at-least-32-characters',
      }),
      logger: silentLogger,
    });

    await expect(start).rejects.toThrow(
      'The stored GitHub App cannot be decrypted. BETTER_AUTH_SECRET changed since the App was created.',
    );
  });

  it('listens only on the host API_HOST names', async () => {
    const server = await startServer({
      env: testEnv({ DATABASE_URL: database.url, API_HOST: '127.0.0.1', API_PORT: 0 }),
      logger: silentLogger,
    });

    try {
      expect((await fetch(`http://127.0.0.1:${server.port}/api/auth/ok`)).status).toBe(200);
      await expect(fetch(`http://[::1]:${server.port}/api/auth/ok`)).rejects.toThrow(
        'fetch failed',
      );
    } finally {
      await server.close();
    }
  });
});

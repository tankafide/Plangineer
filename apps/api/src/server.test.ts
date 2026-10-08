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

    const response = await fetch(`http://localhost:${server.port}/api/auth/ok`);

    expect(server.port).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(`http://localhost:${server.port}/api/auth/ok`)).rejects.toThrow(
      'fetch failed',
    );
  });
});

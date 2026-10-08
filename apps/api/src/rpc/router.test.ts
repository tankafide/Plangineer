import { call, ORPCError } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger, storeUser, testAuth } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { router } from './router.ts';

describe('me.get', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('throws UNAUTHORIZED without a session', async () => {
    const result = call(router.me.get, undefined, {
      context: { logger: silentLogger, session: null },
    });

    await expect(result).rejects.toThrow(ORPCError);
    await expect(result).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('returns the session user', async () => {
    const stored = await storeUser(testAuth(database.db), { name: 'Grace Hopper' });
    const sessionUser = { id: stored.id, name: stored.name, email: stored.email, role: 'member' };

    const result = await call(router.me.get, undefined, {
      context: { logger: silentLogger, session: { user: sessionUser } },
    });

    expect(result).toEqual(sessionUser);
  });
});

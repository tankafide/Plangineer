import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../db/schema.ts';
import { storeUser, testAuth } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createAuth', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('stores a new user with a uuidv7 id from Postgres and the role member', async () => {
    const created = await storeUser(testAuth(database.db));

    const [row] = await database.db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.email, created.email));
    expect(row?.id).toMatch(UUID_V7);
    expect(row).toEqual({ id: created.id, role: 'member' });
  });
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { user } from '../db/schema.ts';
import { SEED_USER_IDS } from '../db/seed-ids.ts';
import { storeUser, testAuth } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createAuth', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.drop();
  });

  async function roleOf(id: string) {
    const [row] = await database.db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, id));
    return row;
  }

  it('makes the first user an admin and the second a member, with uuidv7 ids', async () => {
    const auth = testAuth(database.db);

    const first = await storeUser(auth);
    const second = await storeUser(auth);

    expect(first.id).toMatch(UUID_V7);
    expect(await roleOf(first.id)).toEqual({ id: first.id, role: 'admin' });
    expect(await roleOf(second.id)).toEqual({ id: second.id, role: 'member' });
  });

  it('makes the first real user an admin when only the seeded admin exists', async () => {
    await database.db.insert(user).values({
      id: SEED_USER_IDS.admin,
      name: 'Seed Admin',
      email: 'seed-admin@example.com',
      role: 'admin',
    });

    const real = await storeUser(testAuth(database.db));

    expect(await roleOf(real.id)).toEqual({ id: real.id, role: 'admin' });
  });
});

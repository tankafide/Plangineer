import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brokenConstraint } from '../test/broken-constraint.ts';
import { storeRunner, storeUser, testAuth } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { runnerLogins } from './schema.ts';

const login = (overrides: Partial<typeof runnerLogins.$inferInsert> = {}) => ({
  deviceSecretHash: randomBytes(32).toString('hex'),
  userCodeHash: randomBytes(32).toString('hex'),
  name: 'workstation',
  platform: 'linux' as const,
  expiresAt: new Date(),
  ...overrides,
});

describe('runner_logins constraints', () => {
  let database: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    await database.drop();
  });

  it('accepts a pending login request with no user, and a completed one with both', async () => {
    const runnerId = await storeRunner(database.db, { userId });

    await expect(database.db.insert(runnerLogins).values(login())).resolves.toBeDefined();
    await expect(
      database.db.insert(runnerLogins).values(login({ status: 'completed', userId, runnerId })),
    ).resolves.toBeDefined();
  });

  it('rejects a pending login request with a user', async () => {
    expect(await brokenConstraint(database.db.insert(runnerLogins).values(login({ userId })))).toBe(
      'runner_logins_user_id_check',
    );
  });

  it('rejects an approved login request with no user', async () => {
    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ status: 'approved' })),
      ),
    ).toBe('runner_logins_user_id_check');
  });

  it('rejects a completed login request with no runner', async () => {
    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ status: 'completed', userId })),
      ),
    ).toBe('runner_logins_runner_id_check');
  });

  it('rejects an approved login request with a runner', async () => {
    const runnerId = await storeRunner(database.db, { userId });

    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ status: 'approved', userId, runnerId })),
      ),
    ).toBe('runner_logins_runner_id_check');
  });

  it('rejects a name of 101 characters', async () => {
    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ name: 'x'.repeat(101) })),
      ),
    ).toBe('runner_logins_name_length_check');
  });

  it('rejects a repeated device secret hash, user code hash and runner', async () => {
    const first = login();
    await database.db.insert(runnerLogins).values(first);
    const runnerId = await storeRunner(database.db, { userId });
    await database.db.insert(runnerLogins).values(login({ status: 'completed', userId, runnerId }));

    expect(
      await brokenConstraint(
        database.db
          .insert(runnerLogins)
          .values(login({ deviceSecretHash: first.deviceSecretHash })),
      ),
    ).toBe('runner_logins_device_secret_hash_key');
    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ userCodeHash: first.userCodeHash })),
      ),
    ).toBe('runner_logins_user_code_hash_key');
    expect(
      await brokenConstraint(
        database.db.insert(runnerLogins).values(login({ status: 'completed', userId, runnerId })),
      ),
    ).toBe('runner_logins_runner_id_key');
  });
});

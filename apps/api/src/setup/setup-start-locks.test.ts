import { call } from '@orpc/server';
import { BASELINE_CATALOG } from '@plangineer/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositorySetups } from '../db/schema.ts';
import { lockRepository } from '../repositories/repository-repository.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeRepository, testScan } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const REQUIRED = BASELINE_CATALOG.filter((entry) => entry.required).map((entry) => entry.name);

/** Start takes the repository row lock before the setup, in the order scan and remove take them. */
describe('repositorySetup.start lock order', () => {
  let database: TestDatabase;
  let admin: InitialContext;
  let adminId: string;
  let runnerId: string;
  let githubId = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
    const stored = await storeUser(testAuth(database.db), { role: 'admin' });
    adminId = stored.id;
    admin = {
      ...testDeps(database.db),
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'admin' } },
    };
    runnerId = await storeRunner(database.db, { userId: adminId });
  });

  afterAll(async () => {
    await database.drop();
  });

  async function scannedRepository() {
    githubId += 1;
    const repositoryId = await storeRepository(database.db, {
      createdBy: adminId,
      githubRepositoryId: githubId,
      name: `app-${githubId}`,
    });
    await database.db
      .insert(repositorySetups)
      .values({ repositoryId, status: 'scanned', scan: testScan() });
    return repositoryId;
  }

  const start = (repositoryId: string) =>
    call(
      router.repositorySetup.start,
      {
        repositoryId,
        runnerId,
        selection: { reuseSkills: [], addSkills: REQUIRED, orchestrators: [] },
      },
      { context: admin },
    );

  it('waits for the repository row lock that scan and remove hold', async () => {
    const repositoryId = await scannedRepository();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = database.db.transaction(async (tx) => {
      await lockRepository(tx, repositoryId);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;

    const started = start(repositoryId);

    await expect
      .poll(async () => {
        const result = await database.db.execute<{ waiting: number }>(
          sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
        );
        return result.rows[0]?.waiting;
      })
      .toBe(1);
    release.resolve();
    await holder;
    await expect(started).resolves.toMatchObject({ setup: { status: 'generating' } });
  });
});

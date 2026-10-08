import { call } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, queueRun, runRow, startedEvent, storedEvents } from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from '../runs/dispatch.ts';

describe('runner procedures', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  async function member() {
    const user = await storeUser(testAuth(database.db));
    const context: InitialContext = {
      ...testDeps(database.db),
      session: { user: { id: user.id, name: user.name, email: user.email, role: 'member' } },
    };
    return { id: user.id, context };
  }

  describe('runner.list', () => {
    it("returns only the caller's runners, pages with nextCursor, and shows online", async () => {
      const { id: userId, context } = await member();
      const other = await member();
      await storeRunner(database.db, { userId: other.id });
      const offline = await storeRunner(database.db, {
        userId,
        lastSeenAt: new Date(Date.now() - 60_000),
      });
      const online = await storeRunner(database.db, { userId });
      const never = await storeRunner(database.db, { userId, lastSeenAt: null });

      const first = await call(router.runner.list, { limit: 2 }, { context });
      const second = await call(
        router.runner.list,
        { limit: 2, cursor: first.nextCursor ?? undefined },
        { context },
      );

      expect([...first.items, ...second.items].map((runner) => [runner.id, runner.online])).toEqual(
        [
          [never, false],
          [online, true],
          [offline, false],
        ],
      );
      expect(first.nextCursor).toBe(online);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('runner.revoke', () => {
    it('marks the runner revoked and cancels its queued, leased and running runs', async () => {
      const { id: userId, context } = await member();
      const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 2 });
      const deps = testDeps(database.db);
      const running = await queueRun(deps, userId, runnerId);
      const leased = await queueRun(deps, userId, runnerId);
      await claimRuns(deps, runnerId);
      await appendRunnerEvents(deps, running, [startedEvent]);
      const queued = await queueRun(deps, userId, runnerId);

      const runner = await call(router.runner.revoke, { runnerId }, { context });

      expect(runner).toMatchObject({ id: runnerId, status: 'revoked' });
      expect(runner.revokedAt).not.toBeNull();
      for (const runId of [running, leased, queued]) {
        expect((await runRow(database.db, runId)).status).toBe('cancelled');
        expect((await storedEvents(database.db, runId)).at(-1)?.payload).toMatchObject({
          type: 'run.cancelled',
          reason: 'runner_revoked',
        });
      }
    });

    it('returns a revoked runner unchanged on a second revoke', async () => {
      const { id: userId, context } = await member();
      const runnerId = await storeRunner(database.db, { userId });
      const first = await call(router.runner.revoke, { runnerId }, { context });

      expect(await call(router.runner.revoke, { runnerId }, { context })).toEqual(first);
    });

    it("returns NOT_FOUND for another user's runner", async () => {
      const { context } = await member();
      const other = await member();
      const runnerId = await storeRunner(database.db, { userId: other.id });

      await expect(call(router.runner.revoke, { runnerId }, { context })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

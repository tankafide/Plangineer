import { call } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, runRow, startedEvent, storedEvents } from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from './dispatch.ts';

const input = (runnerId: string) => ({
  runnerId,
  repository: { owner: 'acme', name: 'app' },
  ref: 'main',
  prompt: 'List the files.',
});

const create = (ctx: InitialContext, runner: string) =>
  call(router.run.create, input(runner), { context: ctx });

describe('run procedures', () => {
  let database: TestDatabase;
  let userId: string;
  let runnerId: string;
  let context: InitialContext;

  async function member() {
    const user = await storeUser(testAuth(database.db));
    return {
      id: user.id,
      context: {
        ...testDeps(database.db),
        session: { user: { id: user.id, name: user.name, email: user.email, role: 'member' } },
      },
    };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    ({ id: userId, context } = await member());
    runnerId = await storeRunner(database.db, { userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  describe('run.create', () => {
    it('stores a queued run with a run.queued event', async () => {
      const run = await create(context, runnerId);

      expect(run).toMatchObject({
        status: 'queued',
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
        attempt: 0,
        cancelRequested: false,
        runner: { id: runnerId, name: 'workstation', online: true },
      });
      expect((await storedEvents(database.db, run.id)).map((event) => event.type)).toEqual([
        'run.queued',
      ]);
    });

    it("rejects another user's runner with NOT_FOUND", async () => {
      const other = await member();

      await expect(create(other.context, runnerId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a revoked runner with CONFLICT', async () => {
      const revoked = await storeRunner(database.db, {
        userId,
        status: 'revoked',
        revokedAt: new Date(),
      });

      await expect(create(context, revoked)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('queues a run on an offline runner', async () => {
      const offline = await storeRunner(database.db, { userId, lastSeenAt: null });

      const run = await create(context, offline);

      expect(run).toMatchObject({ status: 'queued', runner: { online: false } });
    });
  });

  describe('run.cancel', () => {
    it('ends a queued run cancelled at once', async () => {
      const { id } = await create(context, runnerId);

      const run = await call(router.run.cancel, { runId: id }, { context });

      expect(run).toMatchObject({ status: 'cancelled', cancelRequested: true });
      expect(run.endedAt).not.toBeNull();
      expect((await storedEvents(database.db, id)).map((event) => event.type)).toEqual([
        'run.queued',
        'run.cancel_requested',
        'run.cancelled',
      ]);
    });

    it('sets the flag and appends run.cancel_requested on a running run', async () => {
      const busy = await storeRunner(database.db, { userId, concurrencyLimit: 1 });
      const { id } = await create(context, busy);
      await claimRuns(testDeps(database.db), busy);
      await appendRunnerEvents(testDeps(database.db), id, [startedEvent]);

      const run = await call(router.run.cancel, { runId: id }, { context });

      expect(run).toMatchObject({ status: 'running', cancelRequested: true });
      expect((await runRow(database.db, id)).cancelRequested).toBe(true);
      expect((await storedEvents(database.db, id)).at(-1)?.type).toBe('run.cancel_requested');
    });

    it('returns CONFLICT on a terminal run', async () => {
      const { id } = await create(context, runnerId);
      await call(router.run.cancel, { runId: id }, { context });

      await expect(call(router.run.cancel, { runId: id }, { context })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe("another user's runs", () => {
    it('are NOT_FOUND to run.get and run.cancel, and missing from run.list', async () => {
      const { id } = await create(context, runnerId);
      const other = await member();
      const otherRunner = await storeRunner(database.db, { userId: other.id });
      const own = await create(other.context, otherRunner);

      await expect(
        call(router.run.get, { runId: id }, { context: other.context }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        call(router.run.cancel, { runId: id }, { context: other.context }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const page = await call(router.run.list, {}, { context: other.context });
      expect(page.items.map((run) => run.id)).toEqual([own.id]);
    });
  });

  describe('run.list', () => {
    it('pages newest first with nextCursor', async () => {
      const { id: ownerId, context: ownerContext } = await member();
      const runner = await storeRunner(database.db, { userId: ownerId });
      const created = [];
      for (let index = 0; index < 3; index += 1) created.push(await create(ownerContext, runner));

      const first = await call(router.run.list, { limit: 2 }, { context: ownerContext });
      const second = await call(
        router.run.list,
        { limit: 2, cursor: first.nextCursor ?? undefined },
        { context: ownerContext },
      );

      expect(first.items.map((run) => run.id)).toEqual([created[2]?.id, created[1]?.id]);
      expect(second.items.map((run) => run.id)).toEqual([created[0]?.id]);
      expect(second.nextCursor).toBeNull();
      expect(first.items[0]).not.toHaveProperty('prompt');
    });
  });
});

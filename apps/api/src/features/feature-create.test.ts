import { call } from '@orpc/server';
import { PrePlanningJob } from '@plangineer/contracts';
import { asc, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureRepositories, features, prePlanningTasks, runEvents, runs } from '../db/schema.ts';
import { lockRunnerForUser, markRunnerRevoked } from '../runners/runner-repository.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const MISSING_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

describe('feature.create', () => {
  let database: TestDatabase;
  let adminId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    adminId = (await storeUser(testAuth(database.db), { role: 'admin' })).id;
    repositoryId = await storeRepository(database.db, {
      createdBy: adminId,
      defaultBranch: 'trunk',
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  async function viewer() {
    const stored = await storeUser(testAuth(database.db), { role: 'member' });
    const context: InitialContext = {
      ...testDeps(database.db),
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, context };
  }

  const input = (overrides: Record<string, unknown> = {}) => ({
    description: 'Add dark mode\n\nEvery screen follows the system theme.',
    ticketUrl: 'https://tickets.example.com/PLAN-7',
    attachments: [
      new File(['# Notes'], 'notes.md', { type: 'text/markdown' }),
      new File([new Uint8Array([137, 80, 78, 71])], 'screen.png', { type: 'image/png' }),
    ],
    exploreCodebase: true,
    researchTopics: ['Colour contrast', 'Theme tokens'],
    runMode: 'manual_plan' as const,
    repositoryIds: [repositoryId],
    ...overrides,
  });

  async function storedTasks(featureId: string) {
    return database.db
      .select({
        kind: prePlanningTasks.kind,
        topic: prePlanningTasks.topic,
        job: prePlanningTasks.job,
        runKind: runs.kind,
        status: runs.status,
        runnerId: runs.runnerId,
        ref: runs.ref,
        queued: sql<number>`(SELECT count(*)::int FROM ${runEvents} WHERE ${runEvents.runId} = ${runs.id} AND ${runEvents.type} = 'run.queued')`,
      })
      .from(prePlanningTasks)
      .innerJoin(runs, eq(runs.id, prePlanningTasks.runId))
      .where(eq(prePlanningTasks.featureId, featureId))
      .orderBy(asc(prePlanningTasks.id));
  }

  async function rowsOf(userId: string) {
    const [featureRow] = await database.db
      .select({ n: count() })
      .from(features)
      .where(eq(features.authorId, userId));
    const [runRow] = await database.db
      .select({ n: count() })
      .from(runs)
      .where(eq(runs.userId, userId));
    return { features: featureRow?.n, runs: runRow?.n };
  }

  it('stores the feature, its repository, attachments and four tasks queued on the most recently seen runner at the stored default branch', async () => {
    const { userId, context } = await viewer();
    await storeRunner(database.db, { userId, lastSeenAt: new Date(Date.now() - 60_000) });
    const picked = await storeRunner(database.db, { userId, lastSeenAt: new Date() });
    await storeRunner(database.db, {
      userId,
      status: 'revoked',
      revokedAt: new Date(),
      lastSeenAt: new Date(Date.now() + 60_000),
    });

    const detail = await call(router.feature.create, input(), { context });

    expect(detail).toMatchObject({
      title: 'Add dark mode',
      state: 'pre_planning',
      runMode: 'manual_plan',
      ticketUrl: 'https://tickets.example.com/PLAN-7',
      exploreCodebase: true,
      repositories: [{ id: repositoryId, owner: 'acme', name: 'app' }],
    });
    expect(
      detail.attachments.map(({ name, mediaType, sizeBytes }) => ({ name, mediaType, sizeBytes })),
    ).toEqual([
      { name: 'notes.md', mediaType: 'text/markdown', sizeBytes: 7 },
      { name: 'screen.png', mediaType: 'image/png', sizeBytes: 4 },
    ]);
    const [involved] = await database.db
      .select({ repositoryId: featureRepositories.repositoryId })
      .from(featureRepositories)
      .where(eq(featureRepositories.featureId, detail.id));
    expect(involved?.repositoryId).toBe(repositoryId);
    const tasks = await storedTasks(detail.id);
    expect(tasks.map(({ kind, topic }) => [kind, topic])).toEqual([
      ['intake', null],
      ['exploration', null],
      ['research', 'Colour contrast'],
      ['research', 'Theme tokens'],
    ]);
    for (const task of tasks) {
      expect(task).toMatchObject({
        runKind: 'pre_planning',
        status: 'queued',
        runnerId: picked,
        ref: 'trunk',
        queued: 1,
      });
      const job = PrePlanningJob.parse(task.job);
      expect(job).toMatchObject({ task: task.kind, ref: 'trunk' });
      expect(job.attachments).toEqual(task.kind === 'intake' ? detail.attachments : []);
    }
  });

  it('stores one intake task with exploration unticked and no topics', async () => {
    const { userId, context } = await viewer();
    await storeRunner(database.db, { userId });

    const detail = await call(
      router.feature.create,
      input({ exploreCodebase: false, researchTopics: [], attachments: [] }),
      { context },
    );

    expect((await storedTasks(detail.id)).map((task) => task.kind)).toEqual(['intake']);
    expect(detail.tasks).toEqual([expect.objectContaining({ kind: 'intake', status: 'queued' })]);
  });

  it('answers NOT_FOUND for an unknown repository and stores nothing', async () => {
    const { userId, context } = await viewer();
    await storeRunner(database.db, { userId });

    await expect(
      call(router.feature.create, input({ repositoryIds: [MISSING_ID] }), { context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await rowsOf(userId)).toEqual({ features: 0, runs: 0 });
  });

  it('answers RUNNER_REQUIRED when every runner of the viewer is revoked, and stores nothing', async () => {
    const { userId, context } = await viewer();
    await storeRunner(database.db, { userId, status: 'revoked', revokedAt: new Date() });

    await expect(call(router.feature.create, input(), { context })).rejects.toMatchObject({
      code: 'RUNNER_REQUIRED',
      status: 409,
    });
    expect(await rowsOf(userId)).toEqual({ features: 0, runs: 0 });
  });

  it('answers RUNNER_REQUIRED when the picked runner is revoked before its lock is taken, and stores nothing', async () => {
    const { userId, context } = await viewer();
    const runnerId = await storeRunner(database.db, { userId });
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const revoker = database.db.transaction(async (tx) => {
      await lockRunnerForUser(tx, userId, runnerId);
      locked.resolve();
      await release.promise;
      await markRunnerRevoked(tx, runnerId);
    });
    await locked.promise;

    const created = call(router.feature.create, input(), { context });
    await expect
      .poll(async () => {
        const result = await database.db.execute<{ waiting: number }>(
          sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
        );
        return result.rows[0]?.waiting;
      })
      .toBe(1);
    release.resolve();
    await revoker;

    await expect(created).rejects.toMatchObject({ code: 'RUNNER_REQUIRED' });
    expect(await rowsOf(userId)).toEqual({ features: 0, runs: 0 });
  });
});

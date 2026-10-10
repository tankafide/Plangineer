import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planningTurns, runners, runs } from '../db/schema.ts';
import { storeFeature, storeTask, testPrePlanningJob } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeTurn } from '../test/planning.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { queueRun, runRow, storedEvents } from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from './dispatch.ts';

describe('claimRuns', () => {
  let database: TestDatabase;
  let userId: string;
  const deps = () => testDeps(database.db);

  beforeAll(async () => {
    database = await createTestDatabase();
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    await database.drop();
  });

  it('leases exactly 2 of 3 queued runs, each once, under two concurrent claims', async () => {
    const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 2 });
    const queued = [];
    for (let index = 0; index < 3; index += 1)
      queued.push(await queueRun(deps(), userId, runnerId));

    const [first, second] = await Promise.all([
      claimRuns(deps(), runnerId),
      claimRuns(deps(), runnerId),
    ]);

    const claimed = [...(first ?? []), ...(second ?? [])].map((run) => run.runId);
    expect(claimed.toSorted()).toEqual(queued.slice(0, 2).toSorted());
    for (const runId of claimed) {
      expect(await runRow(database.db, runId)).toMatchObject({ status: 'leased', attempt: 1 });
      expect((await storedEvents(database.db, runId)).map((event) => event.type)).toEqual([
        'run.queued',
        'run.leased',
      ]);
    }
    expect((await runRow(database.db, queued[2] ?? '')).status).toBe('queued');
  });

  it('returns a test job and a lease expiry', async () => {
    const runnerId = await storeRunner(database.db, { userId });
    const runId = await queueRun(deps(), userId, runnerId);

    const [claimed] = await claimRuns(deps(), runnerId);

    expect(claimed).toEqual({
      runId,
      attempt: 1,
      job: {
        kind: 'test',
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
      },
    });
    expect((await runRow(database.db, runId)).leaseExpiresAt).not.toBeNull();
  });

  it('leases a queued pre_planning run with the job stored on its task', async () => {
    const runnerId = await storeRunner(database.db, { userId });
    const repositoryId = await storeRepository(database.db, { createdBy: userId });
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const { runId } = await storeTask(deps(), {
      featureId,
      repositoryId,
      userId,
      runnerId,
      kind: 'research',
    });

    const [claimed] = await claimRuns(deps(), runnerId);

    expect(claimed).toEqual({ runId, attempt: 1, job: testPrePlanningJob({ task: 'research' }) });
    expect((await runRow(database.db, runId)).status).toBe('leased');
  });

  it.each([
    ['an offline runner', { lastSeenAt: new Date(Date.now() - 60_000) }],
    ['a runner that was never seen', { lastSeenAt: null }],
    ['a revoked runner', { status: 'revoked' as const, revokedAt: new Date() }],
    [
      'a runner with a plan limit in the future',
      { planLimitResetsAt: new Date(Date.now() + 60_000) },
    ],
    ['a runner that never said hello', { concurrencyLimit: null }],
  ])('leases nothing for %s', async (_name, overrides) => {
    const runnerId = await storeRunner(database.db, { userId });
    const runId = await queueRun(deps(), userId, runnerId);
    await database.db.update(runners).set(overrides).where(eq(runners.id, runnerId));

    expect(await claimRuns(deps(), runnerId)).toEqual([]);
    expect((await runRow(database.db, runId)).status).toBe('queued');
  });

  it('leases a run on a runner whose plan limit has passed', async () => {
    const runnerId = await storeRunner(database.db, {
      userId,
      planLimitResetsAt: new Date(Date.now() - 1_000),
    });
    const runId = await queueRun(deps(), userId, runnerId);

    expect((await claimRuns(deps(), runnerId)).map((run) => run.runId)).toEqual([runId]);
  });

  it('skips a queued run with a cancel request', async () => {
    const runnerId = await storeRunner(database.db, { userId });
    const runId = await queueRun(deps(), userId, runnerId);
    await database.db.update(runs).set({ cancelRequested: true }).where(eq(runs.id, runId));

    expect(await claimRuns(deps(), runnerId)).toEqual([]);
  });

  it('leases no more than the free slots beside active runs', async () => {
    const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 1 });
    await queueRun(deps(), userId, runnerId);
    await claimRuns(deps(), runnerId);
    await queueRun(deps(), userId, runnerId);

    expect(await claimRuns(deps(), runnerId)).toEqual([]);
  });

  it('leases a queued planning run with the job stored on its turn', async () => {
    const runnerId = await storeRunner(database.db, { userId });
    const repositoryId = await storeRepository(database.db, {
      createdBy: userId,
      githubRepositoryId: 3301,
    });
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const { runId } = await storeTurn(deps(), {
      featureId,
      userId,
      runnerId,
      spec: { kind: 'section_action', section: 'goal', action: 'expand' },
    });
    const [turn] = await database.db
      .select({ job: planningTurns.job })
      .from(planningTurns)
      .where(eq(planningTurns.runId, runId));

    const [claimed] = await claimRuns(deps(), runnerId);

    expect(claimed).toEqual({ runId, attempt: 1, job: turn?.job });
    expect(claimed?.job).toMatchObject({
      kind: 'planning',
      turn: 'section_action',
      section: 'goal',
    });
    expect((await runRow(database.db, runId)).status).toBe('leased');
  });
});

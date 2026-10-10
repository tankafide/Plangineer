import { call } from '@orpc/server';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { features, planningTurns, runs } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { onRunEnded } from '../runs/run-ended.ts';
import { sweepLapsedLeases } from '../runs/sweeper.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { latestTurn } from '../test/planning.ts';
import { appendRunnerEvents, runRow, startedEvent, succeededEvent } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('starting a planning session', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    const admin = await storeUser(testAuth(database.db), { role: 'admin' });
    repositoryId = await storeRepository(database.db, { createdBy: admin.id });
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A member with a runner, and the context their procedures run in. */
  async function viewer(runner: { status: 'active' | 'revoked' } = { status: 'active' }) {
    const stored = await storeUser(testAuth(database.db), { role: 'member' });
    const runnerId = await storeRunner(database.db, {
      userId: stored.id,
      concurrencyLimit: 16,
      status: runner.status,
      revokedAt: runner.status === 'revoked' ? new Date() : null,
    });
    const context: InitialContext = {
      ...deps,
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, runnerId, context };
  }

  const stateOf = async (featureId: string) => {
    const [row] = await database.db
      .select({ state: features.state })
      .from(features)
      .where(eq(features.id, featureId));
    return row?.state;
  };

  /** The feature's newest turn and its run. */
  async function queuedTurn(featureId: string) {
    const turn = await latestTurn(database.db, featureId);
    return { turn, run: await runRow(database.db, turn.runId) };
  }

  it('moves a Manual plan_ready feature to planning and queues one guided planning run on the viewer runner', async () => {
    const { userId, runnerId, context } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'plan_ready',
    });

    const started = await call(router.feature.startPlanning, { featureId }, { context });

    const { turn, run } = await queuedTurn(featureId);
    expect(started.state).toBe('planning');
    expect(turn).toMatchObject({ kind: 'guided', section: null, stepId: null });
    expect(run).toMatchObject({
      kind: 'planning',
      status: 'queued',
      runnerId,
      userId,
      ref: 'main',
    });
    expect(turn.job).toMatchObject({ kind: 'planning', turn: 'guided', ref: 'main' });
  });

  it('answers RUNNER_REQUIRED and stores nothing when the viewer runner is revoked', async () => {
    const { userId, context } = await viewer({ status: 'revoked' });
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'plan_ready',
    });

    await expect(
      call(router.feature.startPlanning, { featureId }, { context }),
    ).rejects.toMatchObject({ code: 'RUNNER_REQUIRED' });

    const [turns] = await database.db
      .select({ n: count() })
      .from(planningTurns)
      .where(eq(planningTurns.featureId, featureId));
    const [planningRuns] = await database.db
      .select({ n: count() })
      .from(runs)
      .where(eq(runs.userId, userId));
    expect([await stateOf(featureId), turns?.n, planningRuns?.n]).toEqual(['plan_ready', 0, 0]);
  });

  it('moves an Auto loop feature whose last task ends to planning with a queued guided turn', async () => {
    const { userId, runnerId } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      runMode: 'auto_loop',
    });
    const task = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, task.runId, [startedEvent, succeededEvent]);

    await onRunEnded(deps, task.runId);

    const { turn, run } = await queuedTurn(featureId);
    expect(await stateOf(featureId)).toBe('planning');
    expect(turn.kind).toBe('guided');
    expect(run).toMatchObject({ kind: 'planning', status: 'queued', runnerId });
  });

  it('starts an Auto loop feature left in plan_ready on the next sweep', async () => {
    const { userId, runnerId } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      runMode: 'auto_loop',
      state: 'plan_ready',
    });

    await sweepLapsedLeases(deps);

    const { turn, run } = await queuedTurn(featureId);
    expect(await stateOf(featureId)).toBe('planning');
    expect(turn.kind).toBe('guided');
    expect(run).toMatchObject({ status: 'queued', runnerId });
  });

  it('starts the planning of a plan_ready feature changed to Auto loop', async () => {
    const { userId, runnerId, context } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'plan_ready',
    });

    const updated = await call(
      router.feature.update,
      { featureId, runMode: 'auto_loop' },
      { context },
    );

    const { turn, run } = await queuedTurn(featureId);
    expect(updated.state).toBe('planning');
    expect(turn.job.settings).toMatchObject({ decisions: 'recommended', planCheckIn: 'skip' });
    expect(run).toMatchObject({ status: 'queued', runnerId });
  });
});

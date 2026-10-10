import type { PrePlanningTaskKind, RunnerRunEventBody } from '@plangineer/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { features } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { revokeRunner } from '../runners/runner-service.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { onRunEnded } from '../runs/run-ended.ts';
import { cancelRun } from '../runs/run-service.ts';
import { sweepLapsedLeases } from '../runs/sweeper.ts';
import type { RunningServer } from '../server.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import {
  storeRunner,
  storeRunnerWithToken,
  storeUser,
  testAuth,
  testDeps,
} from '../test/fixtures.ts';
import { TestRunnerClient } from '../test/runner-client.ts';
import { appendRunnerEvents, lapseLease, startedEvent, succeededEvent } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { startTestServer } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const failedEvent: RunnerRunEventBody = {
  type: 'run.failed',
  reason: 'agent_error',
  message: 'The agent stopped.',
  exitCode: 1,
  stderrTail: [],
};

describe('feature advance after task runs end', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let userId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A pre_planning feature with one queued task per kind, all on one runner. */
  async function featureWithTasks(kinds: PrePlanningTaskKind[], runnerId?: string) {
    const runner = runnerId ?? (await storeRunner(database.db, { userId, concurrencyLimit: 16 }));
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const runIds: string[] = [];
    for (const kind of kinds) {
      const task = await storeTask(deps, {
        featureId,
        repositoryId,
        userId,
        runnerId: runner,
        kind,
      });
      runIds.push(task.runId);
    }
    return { featureId, runnerId: runner, runIds };
  }

  const stateOf = async (featureId: string) =>
    (
      await database.db
        .select({ state: features.state })
        .from(features)
        .where(eq(features.id, featureId))
    )[0]?.state;

  it('moves to plan_ready when the last task run ends, with one failed and one cancelled, and stays pre_planning while one is queued', async () => {
    const { featureId, runnerId, runIds } = await featureWithTasks(['intake', 'exploration']);
    const [intake = '', exploration = ''] = runIds;
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, intake, [startedEvent, failedEvent]);
    await onRunEnded(deps, intake);
    const research = await storeTask(deps, {
      featureId,
      repositoryId,
      userId,
      runnerId,
      kind: 'research',
    });
    await appendRunnerEvents(deps, exploration, [startedEvent, succeededEvent]);
    await onRunEnded(deps, exploration);
    const whileQueued = await stateOf(featureId);

    await cancelRun(deps, userId, research.runId);

    expect(whileQueued).toBe('pre_planning');
    expect(await stateOf(featureId)).toBe('plan_ready');
  });

  it('advances when the sweeper fails a run whose lease lapsed', async () => {
    const { featureId, runnerId, runIds } = await featureWithTasks(['intake']);
    const [runId = ''] = runIds;
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [startedEvent]);
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(deps);

    expect(await stateOf(featureId)).toBe('plan_ready');
  });

  it('advances when a queued task run is cancelled', async () => {
    const { featureId, runIds } = await featureWithTasks(['intake']);

    await cancelRun(deps, userId, runIds[0] ?? '');

    expect(await stateOf(featureId)).toBe('plan_ready');
  });

  it("advances when the task run's runner is revoked", async () => {
    const { featureId, runnerId } = await featureWithTasks(['intake']);

    await revokeRunner(deps, userId, runnerId);

    expect(await stateOf(featureId)).toBe('plan_ready');
  });

  it('reaches plan_ready on the next sweep when every task run ended without advancing it', async () => {
    const { featureId, runnerId, runIds } = await featureWithTasks(['intake', 'research']);
    await claimRuns(deps, runnerId);
    for (const runId of runIds)
      await appendRunnerEvents(deps, runId, [startedEvent, succeededEvent]);
    const before = await stateOf(featureId);

    await sweepLapsedLeases(deps);

    expect(before).toBe('pre_planning');
    expect(await stateOf(featureId)).toBe('plan_ready');
  });

  describe('over the runner socket', () => {
    let server: RunningServer;
    let client: TestRunnerClient | undefined;

    beforeAll(async () => {
      server = await startTestServer(database);
    });

    afterAll(async () => {
      client?.close();
      await server.close();
    });

    it('advances when the runner reports the task run succeeded', async () => {
      const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
      const { featureId, runIds } = await featureWithTasks(['intake'], runnerId);
      client = await TestRunnerClient.connect(server.port, token);
      client.send({
        type: 'hello',
        runnerVersion: '0.0.0',
        platform: 'linux',
        concurrencyLimit: 2,
        clis: [],
        activeRuns: [],
      });
      const assign = await client.next('run.assign');

      client.send({
        type: 'run.events',
        runId: assign.runId,
        attempt: assign.attempt,
        events: [
          { seq: 1, event: startedEvent },
          { seq: 2, event: succeededEvent },
        ],
      });

      expect(assign.runId).toBe(runIds[0]);
      expect(assign.job).toMatchObject({ kind: 'pre_planning', task: 'intake' });
      await expect.poll(() => stateOf(featureId)).toBe('plan_ready');
    });
  });
});

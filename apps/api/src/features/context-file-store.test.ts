import type { PrePlanningTaskKind, RunnerRunEventBody } from '@plangineer/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextFiles, runs } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, runRow, startedEvent, storedEvents } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

type Succeeded = Extract<RunnerRunEventBody, { type: 'run.succeeded' }>;

const answer = (overrides: Partial<Succeeded> = {}): Succeeded => ({
  type: 'run.succeeded',
  resultText: '# Feature brief\n\n## Summary\n\nDark mode.',
  truncated: false,
  costUsd: null,
  durationMs: 1_000,
  numTurns: 1,
  ...overrides,
});

describe('context files from task runs', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let userId: string;
  let runnerId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 16 });
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A task of the kind whose run its runner has claimed and started. */
  async function runningTask(kind: PrePlanningTaskKind) {
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const task = await storeTask(deps, { featureId, repositoryId, userId, runnerId, kind });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, task.runId, [startedEvent]);
    return task;
  }

  const filesOf = (taskId: string) =>
    database.db
      .select({ title: contextFiles.title, content: contextFiles.content })
      .from(contextFiles)
      .where(eq(contextFiles.taskId, taskId));

  it.each([
    ['intake', 'Feature brief'],
    ['exploration', 'Exploration: acme/app'],
    ['research', 'Research: Colour contrast'],
  ] as const)(
    'stores the %s answer as one context file titled %s, and a repeated event adds nothing',
    async (kind, title) => {
      const { taskId, runId } = await runningTask(kind);

      await appendRunnerEvents(deps, runId, [answer()], 2);
      await appendRunnerEvents(deps, runId, [answer({ resultText: 'Changed' })], 2);

      expect(await filesOf(taskId)).toEqual([{ title, content: answer().resultText }]);
      expect((await runRow(database.db, runId)).status).toBe('succeeded');
    },
  );

  it('stores no run.succeeded when its context file cannot be stored, since both share a transaction', async () => {
    const [row] = await database.db
      .insert(runs)
      .values({
        kind: 'pre_planning',
        userId,
        runnerId,
        repositoryOwner: 'acme',
        repositoryName: 'app',
        ref: 'main',
        prompt: 'Write the brief.',
        status: 'running',
        attempt: 1,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        startedAt: new Date(),
      })
      .returning({ id: runs.id });
    const runId = row?.id ?? '';

    await expect(appendRunnerEvents(deps, runId, [answer()])).rejects.toThrow('has no task');

    expect((await runRow(database.db, runId)).status).toBe('running');
    expect(await storedEvents(database.db, runId)).toEqual([]);
  });

  it.each([
    ['a blank', { resultText: ' \n\t' }],
    ['a truncated', { truncated: true }],
  ])(
    'fails the run with protocol_error for %s answer and stores no file',
    async (_name, overrides) => {
      const { taskId, runId } = await runningTask('intake');

      await appendRunnerEvents(deps, runId, [answer(overrides)], 2);

      const events = await storedEvents(database.db, runId);
      expect(events.at(-1)?.payload).toMatchObject({
        type: 'run.failed',
        reason: 'protocol_error',
      });
      expect(events.map((event) => event.type)).not.toContain('run.succeeded');
      expect((await runRow(database.db, runId)).status).toBe('failed');
      expect(await filesOf(taskId)).toEqual([]);
    },
  );
});

import { call } from '@orpc/server';
import { workflowSettingsFor } from '@plangineer/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextFiles, features } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, startedEvent } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const start = (featureId: string, context: InitialContext) =>
  call(router.feature.startPlanning, { featureId }, { context });

describe('feature procedures', () => {
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

  async function viewer() {
    const stored = await storeUser(testAuth(database.db), { role: 'member' });
    const context: InitialContext = {
      ...deps,
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, context };
  }

  const feature = (
    authorId: string,
    overrides: Partial<Pick<typeof features.$inferInsert, 'state' | 'runMode'>> = {},
  ) => storeFeature(database.db, { authorId, repositoryId, ...overrides });

  it("lists only the viewer's features, newest first, across two pages", async () => {
    const { userId, context } = await viewer();
    const other = await viewer();
    const ids = [];
    for (let index = 0; index < 3; index += 1) ids.push(await feature(userId));
    await feature(other.userId);

    const first = await call(router.feature.list, { limit: 2 }, { context });
    const second = await call(
      router.feature.list,
      { limit: 2, cursor: first.nextCursor ?? undefined },
      { context },
    );

    expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(second).toEqual({ items: [expect.objectContaining({ id: ids[0] })], nextCursor: null });
    expect(first.items[0]).toEqual({
      id: ids[2],
      title: 'Add dark mode',
      state: 'pre_planning',
      runMode: 'manual',
      createdAt: expect.any(String),
    });
  });

  it("returns the detail with each task's run status and commit, its context files and the run mode's settings", async () => {
    const { userId, context } = await viewer();
    const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 16 });
    const featureId = await feature(userId, { runMode: 'auto_loop' });
    const intake = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    const research = await storeTask(deps, {
      featureId,
      repositoryId,
      userId,
      runnerId,
      kind: 'research',
    });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, intake.runId, [startedEvent]);
    const [file] = await database.db
      .insert(contextFiles)
      .values({ taskId: intake.taskId, title: 'Feature brief', content: '# Feature brief' })
      .returning({ id: contextFiles.id });

    const detail = await call(router.feature.get, { featureId }, { context });

    expect(detail).toMatchObject({
      id: featureId,
      runMode: 'auto_loop',
      workflowSettings: workflowSettingsFor('auto_loop'),
      repositories: [{ id: repositoryId, owner: 'acme', name: 'app' }],
      attachments: [],
      tasks: [
        {
          id: intake.taskId,
          kind: 'intake',
          topic: null,
          runId: intake.runId,
          status: 'running',
          commit: 'a'.repeat(40),
          repository: { id: repositoryId, owner: 'acme', name: 'app' },
        },
        {
          id: research.taskId,
          kind: 'research',
          topic: 'Colour contrast',
          status: 'leased',
          commit: null,
        },
      ],
      contextFiles: [{ id: file?.id, taskId: intake.taskId, title: 'Feature brief', ticked: true }],
    });
  });

  it("answers NOT_FOUND to another user's feature.get and feature.update", async () => {
    const { userId } = await viewer();
    const other = await viewer();
    const featureId = await feature(userId);

    await expect(
      call(router.feature.get, { featureId }, { context: other.context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      call(router.feature.update, { featureId, runMode: 'auto_loop' }, { context: other.context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('changes the run mode of a pre_planning feature, and the workflow settings follow it', async () => {
    const { userId, context } = await viewer();
    const featureId = await feature(userId);

    const updated = await call(
      router.feature.update,
      { featureId, runMode: 'manual_plan' },
      { context },
    );

    expect(updated).toMatchObject({
      state: 'pre_planning',
      runMode: 'manual_plan',
      workflowSettings: workflowSettingsFor('manual_plan'),
    });
  });

  describe('feature.startPlanning', () => {
    it('moves a Manual feature from plan_ready to planning, then answers CONFLICT already_planning', async () => {
      const { userId, context } = await viewer();
      await storeRunner(database.db, { userId });
      const featureId = await feature(userId, { state: 'plan_ready' });

      const started = await start(featureId, context);

      expect(started.state).toBe('planning');
      await expect(start(featureId, context)).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        data: { reason: 'already_planning' },
      });
    });

    it('answers CONFLICT auto_loop for an Auto loop feature and leaves it plan_ready', async () => {
      const { userId, context } = await viewer();
      const featureId = await feature(userId, { state: 'plan_ready', runMode: 'auto_loop' });

      await expect(start(featureId, context)).rejects.toMatchObject({
        code: 'CONFLICT',
        data: { reason: 'auto_loop' },
      });
      expect((await call(router.feature.get, { featureId }, { context })).state).toBe('plan_ready');
    });

    it('answers NOT_FOUND to another user', async () => {
      const { userId } = await viewer();
      const other = await viewer();
      const featureId = await feature(userId, { state: 'plan_ready' });

      await expect(start(featureId, other.context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

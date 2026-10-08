import { call } from '@orpc/server';
import type { RunnerRunEventBody } from '@plangineer/contracts';
import { BASELINE_CATALOG } from '@plangineer/domain';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { repositorySetups } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { revokeRunner } from '../runners/runner-service.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { cancelRun } from '../runs/run-service.ts';
import { sweepLapsedLeases } from '../runs/sweeper.ts';
import { fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, lapseLease, startedEvent, succeededEvent } from '../test/runs.ts';
import { storeRepository, testScan } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { advanceSetup, advanceSetupOfRun } from './setup-advance.ts';

const REQUIRED = BASELINE_CATALOG.filter((entry) => entry.required).map((entry) => entry.name);

const pushedEvent: RunnerRunEventBody = {
  type: 'setup.pushed',
  branch: 'plangineer/setup',
  commit: 'd'.repeat(40),
  changedPaths: ['.agents/skills/testing/SKILL.md', '.gitattributes'],
  changedPathCount: 2,
};

describe('advanceSetup', () => {
  let database: TestDatabase;
  let fake: FakeGithub;
  let admin: InitialContext;
  let adminId: string;
  let githubId = 0;

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
    const stored = await storeUser(testAuth(database.db), { role: 'admin' });
    adminId = stored.id;
    admin = {
      ...testDeps(database.db),
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'admin' } },
    };
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  /** A started setup whose run a runner has claimed, with the repository on the fake GitHub. */
  async function startedSetup() {
    githubId += 1;
    fake.repositories.push(fakeRepository({ id: githubId, name: `app-${githubId}` }));
    const repositoryId = await storeRepository(database.db, {
      createdBy: adminId,
      githubRepositoryId: githubId,
      name: `app-${githubId}`,
    });
    await database.db
      .insert(repositorySetups)
      .values({ repositoryId, status: 'scanned', scan: testScan() });
    const runnerId = await storeRunner(database.db, { userId: adminId });
    const detail = await call(
      router.repositorySetup.start,
      {
        repositoryId,
        runnerId,
        selection: { reuseSkills: [], addSkills: REQUIRED, orchestrators: ['plan-orchestrator'] },
      },
      { context: admin },
    );
    const runId = detail.setup?.run?.id ?? '';
    await claimRuns(testDeps(database.db), runnerId);
    return { repositoryId, runId, runnerId, githubRepositoryId: githubId };
  }

  async function finishRun(runId: string, bodies: RunnerRunEventBody[]) {
    await appendRunnerEvents(testDeps(database.db), runId, bodies);
    await advanceSetupOfRun(testDeps(database.db), runId);
  }

  async function setupRow(repositoryId: string) {
    const [row] = await database.db
      .select()
      .from(repositorySetups)
      .where(eq(repositorySetups.repositoryId, repositoryId));
    return row;
  }

  const refresh = (repositoryId: string) =>
    call(router.repositorySetup.refresh, { repositoryId }, { context: admin });

  it('opens a pull request from plangineer/setup into the default branch for a pushed run', async () => {
    const { repositoryId, runId, githubRepositoryId } = await startedSetup();

    await finishRun(runId, [startedEvent, pushedEvent, succeededEvent]);

    expect(fake.pullRequests).toEqual([
      expect.objectContaining({
        repositoryId: githubRepositoryId,
        head: 'plangineer/setup',
        base: 'main',
        title: 'Set up Plangineer skills',
        state: 'open',
      }),
    ]);
    expect(fake.pullRequests[0]?.body).toContain('Done');
    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'pr_open',
      pullRequestNumber: 1,
      pullRequestUrl: expect.stringMatching(/\/pull\/1$/),
    });
  });

  it('updates the body of an open setup pull request and creates no second one', async () => {
    const { repositoryId, runId, githubRepositoryId } = await startedSetup();
    fake.pullRequests.push({
      number: 9,
      repositoryId: githubRepositoryId,
      head: 'plangineer/setup',
      base: 'main',
      title: 'Set up Plangineer skills',
      body: 'Old',
      state: 'open',
      merged: false,
    });

    await finishRun(runId, [startedEvent, pushedEvent, succeededEvent]);

    expect(fake.pullRequests).toHaveLength(1);
    expect(fake.pullRequests[0]?.body).not.toBe('Old');
    expect(await setupRow(repositoryId)).toMatchObject({ status: 'pr_open', pullRequestNumber: 9 });
  });

  it('fails a setup whose run succeeded without a push', async () => {
    const { repositoryId, runId } = await startedSetup();

    await finishRun(runId, [startedEvent, succeededEvent]);

    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'failed',
      failureMessage: 'The runner reported no pushed branch.',
    });
  });

  it('fails the setup with the run failure message', async () => {
    const { repositoryId, runId } = await startedSetup();

    await finishRun(runId, [
      startedEvent,
      {
        type: 'run.failed',
        reason: 'setup_invalid_output',
        message: 'backend: name differs from its folder',
        exitCode: null,
        stderrTail: [],
      },
    ]);

    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'failed',
      failureMessage: 'backend: name differs from its folder',
    });
  });

  it('fails the setup when its queued run is cancelled', async () => {
    const { repositoryId } = await startedSetup();
    const runner = await storeRunner(database.db, { userId: adminId, concurrencyLimit: null });
    githubId += 1;
    const queuedRepository = await storeRepository(database.db, {
      createdBy: adminId,
      githubRepositoryId: githubId,
    });
    await database.db
      .insert(repositorySetups)
      .values({ repositoryId: queuedRepository, status: 'scanned', scan: testScan() });
    const detail = await call(
      router.repositorySetup.start,
      {
        repositoryId: queuedRepository,
        runnerId: runner,
        selection: { reuseSkills: [], addSkills: REQUIRED, orchestrators: [] },
      },
      { context: admin },
    );

    await cancelRun(testDeps(database.db), adminId, detail.setup?.run?.id ?? '');

    expect(await setupRow(queuedRepository)).toMatchObject({
      status: 'failed',
      failureMessage: 'The setup run was cancelled.',
    });
    expect((await setupRow(repositoryId))?.status).toBe('generating');
  });

  it('fails the setup when its run loses its lease', async () => {
    const { repositoryId, runId } = await startedSetup();
    await appendRunnerEvents(testDeps(database.db), runId, [startedEvent]);
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(testDeps(database.db));

    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'failed',
      failureMessage: expect.stringContaining('stopped responding'),
    });
  });

  it('fails the setup when its runner is revoked', async () => {
    const { repositoryId, runnerId } = await startedSetup();

    await revokeRunner(testDeps(database.db), adminId, runnerId);

    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'failed',
      failureMessage: 'The setup run was cancelled.',
    });
  });

  it('opens one pull request for two concurrent advances and leaves the setup pr_open', async () => {
    const { repositoryId, runId } = await startedSetup();
    await appendRunnerEvents(testDeps(database.db), runId, [
      startedEvent,
      pushedEvent,
      succeededEvent,
    ]);

    await Promise.all([
      advanceSetup(testDeps(database.db), repositoryId, 'run_ended'),
      advanceSetup(testDeps(database.db), repositoryId, 'run_ended'),
    ]);

    expect(fake.pullRequests).toHaveLength(1);
    expect((await setupRow(repositoryId))?.status).toBe('pr_open');
  });

  it.each([
    ['merged', { merged: true, state: 'closed' as const }, 'complete', null],
    [
      'closed',
      { merged: false, state: 'closed' as const },
      'failed',
      'The setup pull request was closed without merging.',
    ],
  ])('refresh moves a pr_open setup on a %s pull request', async (_name, pr, status, message) => {
    const { repositoryId, runId } = await startedSetup();
    await finishRun(runId, [startedEvent, pushedEvent, succeededEvent]);
    Object.assign(fake.pullRequests[0] ?? {}, pr);

    const detail = await refresh(repositoryId);

    expect(detail.setup).toMatchObject({ status, failureMessage: message });
  });

  it.each([
    ['pr_open', 'following', /\/pulls\/1$/],
    ['generating', 'opening', /\/pulls$/],
  ] as const)(
    'refresh returns GITHUB_FAILED and keeps a %s setup when GitHub fails %s the pull request',
    async (status, _action, path) => {
      const { repositoryId, runId } = await startedSetup();
      const events = [startedEvent, pushedEvent, succeededEvent];
      await appendRunnerEvents(testDeps(database.db), runId, events);
      if (status === 'pr_open') await refresh(repositoryId);
      fake.fail(path, 403, 'Resource not accessible by integration');

      await expect(refresh(repositoryId)).rejects.toMatchObject({
        code: 'GITHUB_FAILED',
        data: { status: 403, message: expect.stringContaining('Resource not accessible') },
      });
      expect(await setupRow(repositoryId)).toMatchObject({ status, failureMessage: null });
    },
  );

  it('fails the setup with GitHub status and message when opening the pull request fails', async () => {
    const { repositoryId, runId } = await startedSetup();
    fake.fail(/\/pulls$/, 422, 'Validation Failed');

    await finishRun(runId, [startedEvent, pushedEvent, succeededEvent]);

    expect(await setupRow(repositoryId)).toMatchObject({
      status: 'failed',
      failureMessage: expect.stringMatching(/^GitHub answered 422: .*Validation Failed/),
    });
  });
});

import { call } from '@orpc/server';
import { SetupJob, type SetupSelection } from '@plangineer/contracts';
import { BASELINE_CATALOG } from '@plangineer/domain';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositorySetups, runs } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { queueRun } from '../test/runs.ts';
import { storeRepository, testScan } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const REQUIRED = BASELINE_CATALOG.filter((entry) => entry.required).map((entry) => entry.name);

function selection(overrides: Partial<SetupSelection> = {}): SetupSelection {
  return {
    reuseSkills: [],
    addSkills: [...REQUIRED, 'backend'],
    orchestrators: ['plan-orchestrator', 'implementation-orchestrator'],
    ...overrides,
  };
}

describe('repositorySetup.start', () => {
  let database: TestDatabase;
  let admin: InitialContext;
  let adminId: string;
  let runnerId: string;
  let githubId = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
    const auth = testAuth(database.db);
    const stored = await storeUser(auth, { role: 'admin' });
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

  /** A repository with a scanned setup, ready to start. */
  async function scannedRepository(scan = testScan()) {
    githubId += 1;
    const repositoryId = await storeRepository(database.db, {
      createdBy: adminId,
      githubRepositoryId: githubId,
    });
    await database.db.insert(repositorySetups).values({ repositoryId, status: 'scanned', scan });
    return repositoryId;
  }

  const start = (repositoryId: string, chosen = selection(), runner = runnerId) =>
    call(
      router.repositorySetup.start,
      { repositoryId, runnerId: runner, selection: chosen },
      { context: admin },
    );

  async function setupRow(repositoryId: string) {
    const [row] = await database.db
      .select()
      .from(repositorySetups)
      .where(eq(repositorySetups.repositoryId, repositoryId));
    return row;
  }

  const runCount = async () => (await database.db.select({ n: count() }).from(runs))[0]?.n;

  it('stores a queued setup run, its job and status generating', async () => {
    const repositoryId = await scannedRepository();

    const detail = await start(repositoryId);

    const setup = await setupRow(repositoryId);
    expect(detail.setup).toMatchObject({
      status: 'generating',
      selection: selection(),
      run: { status: 'queued', startedByViewer: true },
    });
    expect(setup?.runId).toBe(detail.setup?.run?.id);
    const job = SetupJob.parse(setup?.job);
    expect(job).toMatchObject({
      kind: 'setup',
      repository: { owner: 'acme', name: 'app' },
      commit: 'c'.repeat(40),
      defaultBranch: 'main',
      generateSkills: ['backend'],
    });
    expect(job.files.map((file) => file.path)).toContain(
      '.agents/skills/plan-orchestrator/SKILL.md',
    );
    const [run] = await database.db
      .select()
      .from(runs)
      .where(eq(runs.id, setup?.runId ?? ''));
    expect(run).toMatchObject({ kind: 'setup', status: 'queued', ref: 'c'.repeat(40) });
    expect(run?.prompt).toBe(job.prompt);
  });

  it.each([
    ['nothing_chosen', selection({ addSkills: [], orchestrators: [] }), []],
    ['unknown_skill', selection({ addSkills: [...REQUIRED, 'kotlin'] }), ['kotlin']],
    [
      'required_skill_missing',
      selection({ addSkills: REQUIRED.filter((name) => name !== 'testing') }),
      ['testing'],
    ],
  ])(
    'returns INVALID_SELECTION %s with its names, storing no run',
    async (reason, chosen, names) => {
      const repositoryId = await scannedRepository();
      const before = await runCount();

      await expect(start(repositoryId, chosen)).rejects.toMatchObject({
        code: 'INVALID_SELECTION',
        data: { reason, names },
      });
      expect(await runCount()).toBe(before);
      expect((await setupRow(repositoryId))?.status).toBe('scanned');
    },
  );

  it('returns NOT_FOUND for another user runner and a revoked runner, and CONFLICT while generating', async () => {
    const other = await storeUser(testAuth(database.db));
    const othersRunner = await storeRunner(database.db, { userId: other.id });
    const revoked = await storeRunner(database.db, {
      userId: adminId,
      status: 'revoked',
      revokedAt: new Date(),
    });
    const repositoryId = await scannedRepository();

    await expect(start(repositoryId, selection(), othersRunner)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(start(repositoryId, selection(), revoked)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await start(repositoryId);
    await expect(start(repositoryId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gives a claimed setup run its stored job, and a claimed test run a test job', async () => {
    const runner = await storeRunner(database.db, { userId: adminId, concurrencyLimit: 4 });
    const repositoryId = await scannedRepository();
    await start(repositoryId, selection(), runner);
    const testRunId = await queueRun(testDeps(database.db), adminId, runner);
    const stored = SetupJob.parse((await setupRow(repositoryId))?.job);

    const claimed = await claimRuns(testDeps(database.db), runner);

    expect(claimed.map((run) => run.job)).toEqual([
      stored,
      {
        kind: 'test',
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
      },
    ]);
    expect(claimed[1]?.runId).toBe(testRunId);
  });

  it('stores one run for two concurrent starts and refuses the other with CONFLICT', async () => {
    const repositoryId = await scannedRepository();
    const before = await runCount();

    const results = await Promise.allSettled([start(repositoryId), start(repositoryId)]);

    expect(results.map((result) => result.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
    expect(await runCount()).toBe((before ?? 0) + 1);
  });

  it('returns INVALID_SELECTION too_large for a job over its bounds', async () => {
    const skills = Array.from({ length: 200 }, (_, index) => ({
      name: `skill-${index}`,
      description: '|'.repeat(1_024),
      location: 'agents' as const,
    }));
    const repositoryId = await scannedRepository(testScan({ skills }));

    await expect(
      start(repositoryId, selection({ reuseSkills: skills.map((skill) => skill.name) })),
    ).rejects.toMatchObject({
      code: 'INVALID_SELECTION',
      data: { reason: 'too_large', names: [] },
    });
  });
});

import { randomBytes } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brokenConstraint } from '../test/broken-constraint.ts';
import { storeRunner, storeUser, testAuth } from '../test/fixtures.ts';
import { storeRepository, testScan, testSelection, testSetupJob } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import {
  repositories,
  repositorySetups,
  runEvents,
  runnerLogins,
  runners,
  runs,
  user,
} from './schema.ts';

const event = (runId: string, overrides: Partial<typeof runEvents.$inferInsert> = {}) => ({
  runId,
  eventId: 1,
  attempt: 0,
  type: 'run.queued' as const,
  payload: { type: 'run.queued' as const, id: 1, runId, at: new Date().toISOString() },
  ...overrides,
});

const setup = (
  repositoryId: string,
  overrides: Partial<typeof repositorySetups.$inferInsert> = {},
) => ({ repositoryId, status: 'scanned' as const, scan: testScan(), ...overrides });
const started = { selection: testSelection(), job: testSetupJob() };

describe('schema constraints', () => {
  let database: TestDatabase;
  let userId: string;
  let runnerId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    userId = (await storeUser(testAuth(database.db))).id;
    runnerId = await storeRunner(database.db, { userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  const run = (overrides: Partial<typeof runs.$inferInsert> = {}) => ({
    kind: 'test' as const,
    userId,
    runnerId,
    repositoryOwner: 'acme',
    repositoryName: 'app',
    ref: 'main',
    prompt: 'List the files.',
    ...overrides,
  });

  async function storedRunId(): Promise<string> {
    const [row] = await database.db.insert(runs).values(run()).returning({ id: runs.id });
    if (row === undefined) throw new Error('Run insert returned no row');
    return row.id;
  }

  it('rejects a second runner with the same token hash', async () => {
    const tokenHash = randomBytes(32).toString('hex');
    await storeRunner(database.db, { userId, tokenHash });

    expect(await brokenConstraint(storeRunner(database.db, { userId, tokenHash }))).toBe(
      'runners_token_hash_key',
    );
  });

  it('rejects a revoked runner with no revoked_at', async () => {
    expect(await brokenConstraint(storeRunner(database.db, { userId, status: 'revoked' }))).toBe(
      'runners_revoked_at_check',
    );
  });

  it('rejects a runner name of 101 characters', async () => {
    expect(
      await brokenConstraint(storeRunner(database.db, { userId, name: 'x'.repeat(101) })),
    ).toBe('runners_name_length_check');
  });

  it.each([
    ['a leased run with no lease expiry', { status: 'leased' as const }, 'runs_lease_check'],
    ['a prompt of 20,001 characters', { prompt: 'x'.repeat(20_001) }, 'runs_prompt_length_check'],
    ['a negative attempt', { attempt: -1 }, 'runs_attempt_check'],
    [
      'a running run with no started_at',
      { status: 'running' as const, leaseExpiresAt: new Date() },
      'runs_started_at_check',
    ],
    ['a failed run with no ended_at', { status: 'failed' as const }, 'runs_ended_at_check'],
  ])('rejects %s', async (_name, overrides, constraint) => {
    expect(await brokenConstraint(database.db.insert(runs).values(run(overrides)))).toBe(
      constraint,
    );
  });

  it('rejects a run.leased event with a runner sequence', async () => {
    const runId = await storedRunId();

    expect(
      await brokenConstraint(
        database.db.insert(runEvents).values(event(runId, { type: 'run.leased', runnerSeq: 1 })),
      ),
    ).toBe('run_events_runner_seq_check');
  });

  it('rejects a second event with the same run and event id', async () => {
    const runId = await storedRunId();
    await database.db.insert(runEvents).values(event(runId));

    expect(await brokenConstraint(database.db.insert(runEvents).values(event(runId)))).toBe(
      'run_events_run_id_event_id_key',
    );
  });

  it('accepts a running run with started_at and a lease', async () => {
    const write = database.db
      .insert(runs)
      .values(run({ status: 'running', leaseExpiresAt: new Date(), startedAt: new Date() }));

    await expect(write).resolves.toBeDefined();
  });

  it('cascades a user delete to the login requests they approved, their runners, runs and run events', async () => {
    const owner = await storeUser(testAuth(database.db));
    const ownRunner = await storeRunner(database.db, { userId: owner.id });
    await database.db.insert(runnerLogins).values({
      deviceSecretHash: randomBytes(32).toString('hex'),
      userCodeHash: randomBytes(32).toString('hex'),
      name: 'workstation',
      platform: 'linux',
      status: 'approved',
      userId: owner.id,
      expiresAt: new Date(),
    });
    const [ownRun] = await database.db
      .insert(runs)
      .values(run({ userId: owner.id, runnerId: ownRunner }))
      .returning({ id: runs.id });
    if (ownRun === undefined) throw new Error('Run insert returned no row');
    await database.db.insert(runEvents).values(event(ownRun.id));

    await database.db.delete(user).where(eq(user.id, owner.id));

    const counts = await Promise.all([
      database.db
        .select({ n: count() })
        .from(runnerLogins)
        .where(eq(runnerLogins.userId, owner.id)),
      database.db.select({ n: count() }).from(runners).where(eq(runners.userId, owner.id)),
      database.db.select({ n: count() }).from(runs).where(eq(runs.userId, owner.id)),
      database.db.select({ n: count() }).from(runEvents).where(eq(runEvents.runId, ownRun.id)),
    ]);
    expect(counts.map(([row]) => row?.n)).toEqual([0, 0, 0, 0]);
  });

  describe('repositories and their setups', () => {
    let githubRepositoryId = 5000;
    const nextRepository = () => {
      githubRepositoryId += 1;
      return storeRepository(database.db, { createdBy: userId, githubRepositoryId });
    };

    it('rejects a second repository with the same GitHub id', async () => {
      await storeRepository(database.db, { createdBy: userId, githubRepositoryId: 4000 });

      expect(
        await brokenConstraint(
          storeRepository(database.db, { createdBy: userId, githubRepositoryId: 4000 }),
        ),
      ).toBe('repositories_github_repository_id_key');
    });

    it.each([
      ['an empty description', ''],
      ['a description of 201 characters', 'x'.repeat(201)],
    ])('rejects %s', async (_name, description) => {
      expect(
        await brokenConstraint(
          storeRepository(database.db, {
            createdBy: userId,
            githubRepositoryId: 4100,
            description,
          }),
        ),
      ).toBe('repositories_description_length_check');
    });

    it.each([
      [
        'a generating setup with no selection',
        { status: 'generating' as const },
        'repository_setups_started_check',
      ],
      [
        'a pull request number with no URL',
        { pullRequestNumber: 7 },
        'repository_setups_pull_request_pair_check',
      ],
      [
        'an open pull request status with no pull request',
        { status: 'pr_open' as const, ...started },
        'repository_setups_pull_request_check',
      ],
      [
        'a failed setup with no failure message',
        { status: 'failed' as const, ...started },
        'repository_setups_failure_message_check',
      ],
      [
        'a failure message on a scanned setup',
        { failureMessage: 'Broke' },
        'repository_setups_failure_message_check',
      ],
      [
        'a failure message of 2,001 characters',
        { status: 'failed' as const, ...started, failureMessage: 'x'.repeat(2_001) },
        'repository_setups_failure_message_length_check',
      ],
    ])('rejects %s', async (_name, overrides, constraint) => {
      const repositoryId = await nextRepository();

      expect(
        await brokenConstraint(
          database.db.insert(repositorySetups).values(setup(repositoryId, overrides)),
        ),
      ).toBe(constraint);
    });

    it('rejects a second setup for one repository and a second setup for one run', async () => {
      const first = await nextRepository();
      const second = await nextRepository();
      const runId = await storedRunId();
      const withRun = { status: 'generating' as const, ...started, runId };
      await database.db.insert(repositorySetups).values(setup(first, withRun));

      expect(
        await brokenConstraint(database.db.insert(repositorySetups).values(setup(first))),
      ).toBe('repository_setups_repository_id_key');
      expect(
        await brokenConstraint(database.db.insert(repositorySetups).values(setup(second, withRun))),
      ).toBe('repository_setups_run_id_key');
    });

    it('deletes the setup with its repository', async () => {
      const repositoryId = await nextRepository();
      await database.db.insert(repositorySetups).values(setup(repositoryId));

      await database.db.delete(repositories).where(eq(repositories.id, repositoryId));

      const [row] = await database.db
        .select({ n: count() })
        .from(repositorySetups)
        .where(eq(repositorySetups.repositoryId, repositoryId));
      expect(row?.n).toBe(0);
    });
  });
});

import { randomBytes } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeRunner, storeUser, testAuth } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { runEvents, runnerPairingCodes, runners, runs, user } from './schema.ts';

/** Resolves to the name of the constraint a failed write broke. */
async function brokenConstraint(write: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await write.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'constraint' in cause
    ? String(cause.constraint)
    : undefined;
}

const event = (runId: string, overrides: Partial<typeof runEvents.$inferInsert> = {}) => ({
  runId,
  eventId: 1,
  attempt: 0,
  type: 'run.queued' as const,
  payload: { type: 'run.queued' as const, id: 1, runId, at: new Date().toISOString() },
  ...overrides,
});

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

  it('cascades a user delete to their pairing codes, runners, runs and run events', async () => {
    const owner = await storeUser(testAuth(database.db));
    const ownRunner = await storeRunner(database.db, { userId: owner.id });
    await database.db.insert(runnerPairingCodes).values({
      userId: owner.id,
      codeHash: randomBytes(32).toString('hex'),
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
        .from(runnerPairingCodes)
        .where(eq(runnerPairingCodes.userId, owner.id)),
      database.db.select({ n: count() }).from(runners).where(eq(runners.userId, owner.id)),
      database.db.select({ n: count() }).from(runs).where(eq(runs.userId, owner.id)),
      database.db.select({ n: count() }).from(runEvents).where(eq(runEvents.runId, ownRun.id)),
    ]);
    expect(counts.map(([row]) => row?.n)).toEqual([0, 0, 0, 0]);
  });
});

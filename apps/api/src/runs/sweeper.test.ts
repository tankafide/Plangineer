import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  appendRunnerEvents,
  lapseLease,
  queueRun,
  runRow,
  startedEvent,
  storedEvents,
} from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from './dispatch.ts';
import { cancelRun } from './run-service.ts';
import { sweepLapsedLeases } from './sweeper.ts';

describe('sweepLapsedLeases', () => {
  let database: TestDatabase;
  let userId: string;
  const deps = () => testDeps(database.db, { RUN_MAX_ATTEMPTS: 2 });

  beforeAll(async () => {
    database = await createTestDatabase();
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    await database.drop();
  });

  async function leasedRun() {
    const runnerId = await storeRunner(database.db, { userId });
    const runId = await queueRun(deps(), userId, runnerId);
    await claimRuns(deps(), runnerId);
    return { runnerId, runId };
  }

  const types = async (runId: string) =>
    (await storedEvents(database.db, runId)).map((event) => event.type);

  it('requeues a run whose lease lapsed while leased, keeping its attempt', async () => {
    const { runId } = await leasedRun();
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(deps());

    expect(await runRow(database.db, runId)).toMatchObject({
      status: 'queued',
      attempt: 1,
      leaseExpiresAt: null,
    });
    const events = await storedEvents(database.db, runId);
    expect(events.at(-1)?.payload).toMatchObject({
      type: 'run.lease_lost',
      attempt: 1,
      requeued: true,
    });
  });

  it('fails a leased run with lease_lost at RUN_MAX_ATTEMPTS', async () => {
    const { runnerId, runId } = await leasedRun();
    await lapseLease(database.db, runId);
    await sweepLapsedLeases(deps());
    await claimRuns(deps(), runnerId);
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(deps());

    expect(await runRow(database.db, runId)).toMatchObject({ status: 'failed', attempt: 2 });
    const last = (await storedEvents(database.db, runId)).at(-1)?.payload;
    expect(last).toMatchObject({ type: 'run.failed', reason: 'lease_lost' });
  });

  it('fails a running run with lease_lost and never retries it', async () => {
    const { runId } = await leasedRun();
    await appendRunnerEvents(deps(), runId, [startedEvent]);
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(deps());

    expect((await runRow(database.db, runId)).status).toBe('failed');
    expect((await types(runId)).slice(-2)).toEqual(['run.lease_lost', 'run.failed']);
  });

  it('ends a run cancelled when its lease lapses after a cancel request', async () => {
    const { runId } = await leasedRun();
    await appendRunnerEvents(deps(), runId, [startedEvent]);
    await cancelRun(deps(), userId, runId);
    await lapseLease(database.db, runId);

    await sweepLapsedLeases(deps());

    expect((await runRow(database.db, runId)).status).toBe('cancelled');
    const last = (await storedEvents(database.db, runId)).at(-1)?.payload;
    expect(last).toMatchObject({ type: 'run.cancelled', reason: 'requested' });
  });

  it('leaves a run with a live lease alone', async () => {
    const { runId } = await leasedRun();

    await sweepLapsedLeases(deps());

    expect((await runRow(database.db, runId)).status).toBe('leased');
  });
});

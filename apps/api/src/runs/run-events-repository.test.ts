import type { RunnerRunEventBody } from '@plangineer/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNotificationListener, RUN_EVENTS_CHANNEL } from '../realtime/notifications.ts';
import { silentLogger, storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  appendRunnerEvents,
  messageEvent,
  planningOutputEvent,
  queueRun,
  runRow,
  startedEvent,
  storedEvents,
  succeededEvent,
} from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from './dispatch.ts';
import { appendRunEvents } from './run-events-repository.ts';

describe('appendRunEvents', () => {
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

  async function leasedRun() {
    const runnerId = await storeRunner(database.db, { userId });
    const runId = await queueRun(deps(), userId, runnerId);
    await claimRuns(deps(), runnerId);
    return runId;
  }

  it('stores nothing new for a resent batch and returns the same acknowledged sequence', async () => {
    const runId = await leasedRun();
    const batch = [startedEvent, messageEvent('one'), messageEvent('two')];

    const first = await appendRunnerEvents(deps(), runId, batch);
    const again = await appendRunnerEvents(deps(), runId, batch);

    expect(first).toEqual({ ackedSeq: 3, ended: false });
    expect(again).toEqual({ ackedSeq: 3, ended: false });
    const events = await storedEvents(database.db, runId);
    expect(events.map((event) => event.eventId)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((event) => event.runnerSeq)).toEqual([null, null, 1, 2, 3]);
    expect((await runRow(database.db, runId)).lastEventId).toBe(5);
  });

  it('keeps event ids consecutive from 1 across API and runner events', async () => {
    const runId = await leasedRun();
    await appendRunnerEvents(deps(), runId, [startedEvent, messageEvent()]);
    await appendRunnerEvents(deps(), runId, [messageEvent(), succeededEvent], 3);

    const events = await storedEvents(database.db, runId);
    expect(events.map((event) => event.eventId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.payload.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await runRow(database.db, runId)).toMatchObject({
      status: 'succeeded',
      commit: 'a'.repeat(40),
    });
  });

  it('fails the run with protocol_error instead of storing an event the rules reject', async () => {
    const runId = await leasedRun();

    await appendRunnerEvents(deps(), runId, [succeededEvent, messageEvent()]);

    const events = await storedEvents(database.db, runId);
    expect(events.map((event) => event.type)).toEqual(['run.queued', 'run.leased', 'run.failed']);
    expect(events.at(-1)?.payload).toMatchObject({ reason: 'protocol_error' });
    expect(events.at(-1)?.runnerSeq).toBeNull();
    expect((await runRow(database.db, runId)).status).toBe('failed');
  });

  it('fails a test run that sends setup.pushed with protocol_error, and reports it ended', async () => {
    const runId = await leasedRun();
    const pushed: RunnerRunEventBody = {
      type: 'setup.pushed',
      branch: 'plangineer/setup',
      commit: 'd'.repeat(40),
      changedPaths: [],
      changedPathCount: 0,
    };

    const appended = await appendRunnerEvents(deps(), runId, [startedEvent, pushed]);

    const events = await storedEvents(database.db, runId);
    expect(events.at(-1)?.payload).toMatchObject({
      type: 'run.failed',
      reason: 'protocol_error',
      message: 'The runner sent setup.pushed for a test run.',
    });
    expect(appended.ended).toBe(true);
    expect((await runRow(database.db, runId)).status).toBe('failed');
  });

  it('fails a test run that sends planning.output with protocol_error', async () => {
    const runId = await leasedRun();

    await appendRunnerEvents(deps(), runId, [
      startedEvent,
      planningOutputEvent({
        kind: 'step',
        step: { id: 's', title: 'T', files: [], body: '', doneWhen: [] },
      }),
    ]);

    expect((await storedEvents(database.db, runId)).at(-1)?.payload).toMatchObject({
      type: 'run.failed',
      reason: 'protocol_error',
      message: 'The runner sent planning.output for a test run.',
    });
  });

  it('skips runner events on a terminal run, leaves it unchanged, and still acknowledges', async () => {
    const runId = await leasedRun();
    await appendRunnerEvents(deps(), runId, [startedEvent, succeededEvent]);
    const before = await runRow(database.db, runId);

    const acked = await appendRunnerEvents(deps(), runId, [messageEvent()], 3);

    expect(acked).toEqual({ ackedSeq: 2, ended: false });
    expect(await storedEvents(database.db, runId)).toHaveLength(4);
    expect(await runRow(database.db, runId)).toEqual(before);
  });

  it('stores a batch of 100 events with one update of the run and one notification', async () => {
    const runId = await leasedRun();
    await appendRunnerEvents(deps(), runId, [startedEvent]);
    const listener = await createNotificationListener({
      databaseUrl: database.url,
      logger: silentLogger,
    });
    const onNotify = vi.fn<(payload: string) => void>();
    listener.subscribe(RUN_EVENTS_CHANNEL, { onNotify, onReconnect: vi.fn<() => void>() });
    const { attempt } = await runRow(database.db, runId);

    // Postgres flushes table stats lazily, so count this append's updates as a difference.
    const updates = await database.db.transaction(async (tx) => {
      const runUpdates = async () => {
        const result = await tx.execute<{ n_tup_upd: string }>(
          sql`SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relname = 'runs'`,
        );
        return Number(result.rows[0]?.n_tup_upd ?? 0);
      };
      const before = await runUpdates();
      await appendRunEvents(
        tx,
        runId,
        Array.from({ length: 100 }, (_, index) => ({
          body: messageEvent(`message ${index}`),
          attempt,
          runnerSeq: index + 2,
        })),
        { leaseDurationMs: 30_000, logger: silentLogger },
      );
      return (await runUpdates()) - before;
    });

    expect(updates).toBe(1);
    expect((await runRow(database.db, runId)).lastEventId).toBe(103);
    await vi.waitFor(() => expect(onNotify).toHaveBeenCalledWith(runId));
    await database.db.execute(sql`SELECT pg_notify(${RUN_EVENTS_CHANNEL}, 'witness')`);
    await vi.waitFor(() => expect(onNotify).toHaveBeenCalledWith('witness'));
    expect(onNotify.mock.calls.filter(([payload]) => payload === runId)).toHaveLength(1);
    await listener.close();
  });
});

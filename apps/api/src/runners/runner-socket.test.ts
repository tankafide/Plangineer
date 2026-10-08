import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runners } from '../db/schema.ts';
import { cancelRun } from '../runs/run-service.ts';
import { sweepLapsedLeases } from '../runs/sweeper.ts';
import { storeRunnerWithToken, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { TestRunnerClient } from '../test/runner-client.ts';
import {
  lapseLease,
  messageEvent,
  queueRun,
  runRow,
  startedEvent,
  storedEvents,
} from '../test/runs.ts';
import { startTestServer } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import type { RunningServer } from '../server.ts';
import { revokeRunner } from './runner-service.ts';

const CLAUDE = {
  name: 'claude-code',
  version: '2.1.284',
  available: true,
  minimumVersion: '2.1.284',
};

function hello(activeRuns: { runId: string; attempt: number }[] = []) {
  return {
    type: 'hello',
    runnerVersion: '0.0.0',
    platform: 'linux',
    concurrencyLimit: 2,
    clis: [CLAUDE],
    activeRuns,
  } as const;
}

function events(runId: string, attempt: number, bodies: unknown[], firstSeq = 1) {
  return {
    type: 'run.events',
    runId,
    attempt,
    events: bodies.map((event, index) => ({ seq: firstSeq + index, event })),
  };
}

describe('runner socket', () => {
  let database: TestDatabase;
  let server: RunningServer;
  let userId: string;
  const deps = () => testDeps(database.db);
  const open: TestRunnerClient[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    server = await startTestServer(database);
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    for (const client of open) client.close();
    await server.close();
    await database.drop();
  });

  async function connect(token: string, port = server.port, options = {}) {
    const client = await TestRunnerClient.connect(port, token, options);
    open.push(client);
    return client;
  }

  /** A paired runner that has said hello, with its socket. */
  async function helloRunner(overrides = {}) {
    const { runnerId, token } = await storeRunnerWithToken(database.db, { userId, ...overrides });
    const client = await connect(token);
    client.send(hello());
    await client.next('welcome');
    return { runnerId, token, client };
  }

  /** A run assigned to a connected runner, ready for its events. */
  async function assignedRun() {
    const runner = await helloRunner();
    const runId = await queueRun(deps(), userId, runner.runnerId);
    const assign = await runner.client.next('run.assign');
    return { ...runner, runId, attempt: assign.attempt };
  }

  it('says welcome to hello, stores what it reported, and assigns its queued run', async () => {
    const { runnerId, token } = await storeRunnerWithToken(database.db, {
      userId,
      lastSeenAt: null,
      concurrencyLimit: null,
    });
    const runId = await queueRun(deps(), userId, runnerId);
    const client = await connect(token);

    client.send(hello());

    expect(await client.next('welcome')).toEqual({
      type: 'welcome',
      runnerId,
      heartbeatIntervalMs: 10_000,
      runs: [],
    });
    expect(await client.next('run.assign')).toEqual({
      type: 'run.assign',
      runId,
      attempt: 1,
      job: {
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
        permissionMode: 'plan',
      },
    });
    const [row] = await database.db.select().from(runners).where(eq(runners.id, runnerId));
    expect(row).toMatchObject({ concurrencyLimit: 2, runnerVersion: '0.0.0', clis: [CLAUDE] });
    expect(row?.lastSeenAt).not.toBeNull();
  });

  describe('handshake', () => {
    it('answers 401 to an unknown token', async () => {
      await expect(connect('not-a-token')).rejects.toThrow('Handshake answered 401');
    });

    it('answers 401 to a revoked runner', async () => {
      const { token } = await storeRunnerWithToken(database.db, {
        userId,
        status: 'revoked',
        revokedAt: new Date(),
      });

      await expect(connect(token)).rejects.toThrow('Handshake answered 401');
    });

    it('closes a connected runner with 4001 when it is revoked', async () => {
      const { runnerId, client } = await helloRunner();

      await revokeRunner(deps(), userId, runnerId);

      expect(await client.closed).toMatchObject({ code: 4001 });
    });

    it('closes the first socket with 4002 when the same runner connects again', async () => {
      const { token, client: first } = await helloRunner();

      const second = await connect(token);

      expect(await first.closed).toMatchObject({ code: 4002 });
      second.send(hello());
      await expect(second.next('welcome')).resolves.toMatchObject({ type: 'welcome' });
    });
  });

  describe('protocol errors', () => {
    it.each([
      ['a message that fails its schema', JSON.stringify({ type: 'hello' })],
      ['a message that is not JSON', 'not json'],
      ['an unknown message type', JSON.stringify({ type: 'run.assign' })],
    ])('closes the socket with 1008 for %s', async (_name, data) => {
      const { client } = await helloRunner();

      client.sendRaw(data);

      expect(await client.closed).toMatchObject({ code: 1008 });
    });

    it('closes the socket with 1009 for a message over 1 MiB', async () => {
      const { client } = await helloRunner();

      client.sendRaw('x'.repeat(1024 * 1024 + 1));

      expect(await client.closed).toMatchObject({ code: 1009 });
    });
  });

  describe('run.events', () => {
    it('stores and acknowledges a valid batch', async () => {
      const { client, runId, attempt } = await assignedRun();

      client.send(events(runId, attempt, [startedEvent, messageEvent()]));

      expect(await client.next('run.ack')).toEqual({ type: 'run.ack', runId, attempt, seq: 2 });
      expect((await runRow(database.db, runId)).status).toBe('running');
    });

    it("ignores a stale attempt and another runner's run", async () => {
      const { client, runId, attempt } = await assignedRun();
      const other = await assignedRun();

      client.send(events(runId, attempt + 1, [startedEvent]));
      client.send(events(other.runId, other.attempt, [startedEvent]));
      client.send(events(runId, attempt, [startedEvent]));

      expect(await client.next('run.ack')).toMatchObject({ runId, seq: 1 });
      expect(client.received.filter((message) => message.type === 'run.ack')).toHaveLength(1);
      expect((await runRow(database.db, other.runId)).status).toBe('leased');
      expect(await storedEvents(database.db, other.runId)).toHaveLength(2);
    });

    it('ignores late events at the old attempt after the lease lapsed and the run was requeued', async () => {
      const { client, runId, attempt } = await assignedRun();
      // A plan limit keeps the requeued run from being assigned straight back.
      client.send({
        type: 'runner.status',
        planLimitResetsAt: new Date(Date.now() + 60_000).toISOString(),
      });
      client.send({ type: 'run.heartbeat', runId, attempt });
      await client.next('run.heartbeat_reply');
      await lapseLease(database.db, runId);
      await sweepLapsedLeases(deps());

      client.send(events(runId, attempt, [startedEvent]));
      client.send({ type: 'run.heartbeat', runId, attempt });
      await client.next('run.heartbeat_reply', 1);

      expect(await runRow(database.db, runId)).toMatchObject({ status: 'queued', attempt });
      expect(client.received.some((message) => message.type === 'run.ack')).toBe(false);
    });
  });

  describe('run.heartbeat', () => {
    it('extends the lease and reports a cancel request', async () => {
      const { client, runId, attempt } = await assignedRun();
      const before = (await runRow(database.db, runId)).leaseExpiresAt;
      client.send(events(runId, attempt, [startedEvent]));
      await client.next('run.ack');

      client.send({ type: 'run.heartbeat', runId, attempt });
      const first = await client.next('run.heartbeat_reply');
      await cancelRun(deps(), userId, runId);
      const cancel = await client.next('run.cancel');
      client.send({ type: 'run.heartbeat', runId, attempt });
      const second = await client.next('run.heartbeat_reply', 1);

      expect(first).toEqual({
        type: 'run.heartbeat_reply',
        runId,
        attempt,
        valid: true,
        cancelRequested: false,
      });
      expect((await runRow(database.db, runId)).leaseExpiresAt?.getTime()).toBeGreaterThan(
        before?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      expect(cancel).toEqual({ type: 'run.cancel', runId, attempt });
      expect(second).toMatchObject({ valid: true, cancelRequested: true });
    });

    it("answers valid: false for another runner's run and leaves its lease alone", async () => {
      const { client } = await helloRunner();
      const other = await assignedRun();
      const before = (await runRow(database.db, other.runId)).leaseExpiresAt;

      client.send({ type: 'run.heartbeat', runId: other.runId, attempt: other.attempt });

      expect(await client.next('run.heartbeat_reply')).toMatchObject({
        valid: false,
        cancelRequested: false,
      });
      expect((await runRow(database.db, other.runId)).leaseExpiresAt).toEqual(before);
    });
  });

  it('reports ackedSeq and validity for each active run in welcome after a reconnect', async () => {
    const { client, token, runId, attempt } = await assignedRun();
    const other = await assignedRun();
    client.send(events(runId, attempt, [startedEvent, messageEvent(), messageEvent()]));
    await client.next('run.ack');
    client.close();
    await client.closed;

    const again = await connect(token);
    again.send(
      hello([
        { runId, attempt },
        { runId: other.runId, attempt: other.attempt },
      ]),
    );

    expect((await again.next('welcome')).runs).toEqual([
      { runId, attempt, valid: true, ackedSeq: 3 },
      { runId: other.runId, attempt: other.attempt, valid: false, ackedSeq: 0 },
    ]);
  });
});

import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runners } from '../db/schema.ts';
import { claimRuns } from '../runs/dispatch.ts';
import {
  sessionCookie,
  storeRunnerWithToken,
  storeUser,
  testAuth,
  testDeps,
} from '../test/fixtures.ts';
import { TestRunnerClient } from '../test/runner-client.ts';
import { queueRun, startedEvent } from '../test/runs.ts';
import { startTestServer } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const RpcBody = z.object({ json: z.record(z.string(), z.string()) });

function hello() {
  return {
    type: 'hello',
    runnerVersion: '0.0.0',
    platform: 'linux',
    concurrencyLimit: 2,
    clis: [],
    activeRuns: [],
  } as const;
}

describe('runner socket liveness and shutdown', () => {
  let database: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    await database.drop();
  });

  it('records last_seen_at on each pong, and terminates a socket that misses a ping', async () => {
    const server = await startTestServer(database, { RUNNER_HEARTBEAT_INTERVAL_MS: 100 });
    try {
      const { runnerId, token } = await storeRunnerWithToken(database.db, {
        userId,
        lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const live = await TestRunnerClient.connect(server.port, token);
      const lastSeen = async () =>
        (await database.db.select().from(runners).where(eq(runners.id, runnerId)))[0]?.lastSeenAt;

      await vi.waitFor(async () =>
        expect((await lastSeen())?.getTime()).toBeGreaterThan(Date.now() - 5_000),
      );
      live.close();

      const silent = await TestRunnerClient.connect(server.port, token, { autoPong: false });
      expect((await silent.closed).code).toBe(1006);
    } finally {
      await server.close();
    }
  });

  it('assigns a queued run on the next sweep once the plan limit has passed', async () => {
    const server = await startTestServer(database, { RUN_SWEEP_INTERVAL_MS: 100 });
    try {
      const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
      const client = await TestRunnerClient.connect(server.port, token);
      client.send(hello());
      await client.next('welcome');
      client.send({
        type: 'runner.status',
        planLimitResetsAt: new Date(Date.now() + 60_000).toISOString(),
      });
      client.send({ type: 'run.heartbeat', runId: runnerId, attempt: 1 });
      await client.next('run.heartbeat_reply');
      const runId = await queueRun(testDeps(database.db), userId, runnerId);
      expect((await claimRuns(testDeps(database.db), runnerId)).length).toBe(0);

      await database.db
        .update(runners)
        .set({ planLimitResetsAt: sql`now() - interval '1 second'` })
        .where(eq(runners.id, runnerId));

      expect(await client.next('run.assign')).toMatchObject({ runId });
      client.close();
    } finally {
      await server.close();
    }
  });

  it('closes runner sockets with 1001 and ends SSE streams on close()', async () => {
    const server = await startTestServer(database);
    const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
    const client = await TestRunnerClient.connect(server.port, token);
    const runId = await queueRun(testDeps(database.db), userId, runnerId);
    const cookie = await sessionCookie(testAuth(database.db), userId);
    const stream = await fetch(`http://localhost:${server.port}/api/runs/${runId}/events`, {
      headers: { cookie },
    });
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (reader === undefined) throw new Error('The stream has no body');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: run-event');

    await expect(server.close()).resolves.toBeUndefined();

    expect(await client.closed).toMatchObject({ code: 1001 });
    let rest = await reader.read();
    while (!rest.done) rest = await reader.read();
    expect(rest.done).toBe(true);
  });

  it('never logs the pairing code or the runner token through pairing and connection', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line: string) => lines.push(line) });
    const server = await startTestServer(database, {}, logger);
    try {
      const cookie = await sessionCookie(testAuth(database.db), userId);
      const rpc = async (path: string, json: unknown, headers: Record<string, string> = {}) => {
        const response = await fetch(`http://localhost:${server.port}/rpc/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': 'orpc', ...headers },
          body: JSON.stringify({ json }),
        });
        return RpcBody.parse(await response.json());
      };
      const { json: created } = await rpc('runner/createPairingCode', undefined, { cookie });
      const code = created['code'] ?? '';
      const { json: paired } = await rpc('runner/pair', {
        code,
        name: 'logged',
        platform: 'linux',
      });
      const token = paired['token'] ?? '';
      const client = await TestRunnerClient.connect(server.port, token);
      client.send(hello());
      await client.next('welcome');
      client.close();
      await client.closed;

      const output = lines.join('\n');
      expect(code).not.toBe('');
      expect(token).not.toBe('');
      expect(output).toContain('Runner connected');
      expect(output).not.toContain(code);
      expect(output).not.toContain(code.replaceAll('-', ''));
      expect(output).not.toContain(token);
    } finally {
      await server.close();
    }
  });
  it('stores runner.status and clears it with null', async () => {
    const server = await startTestServer(database);
    const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
    const client = await TestRunnerClient.connect(server.port, token);
    client.send(hello());
    await client.next('welcome');
    const resetsAt = new Date(Date.now() + 60_000);
    const planLimit = async () =>
      (await database.db.select().from(runners).where(eq(runners.id, runnerId)))[0]
        ?.planLimitResetsAt;

    client.send({ type: 'runner.status', planLimitResetsAt: resetsAt.toISOString() });
    await vi.waitFor(async () => expect(await planLimit()).toEqual(resetsAt));
    client.send({ type: 'runner.status', planLimitResetsAt: null });

    await vi.waitFor(async () => expect(await planLimit()).toBeNull());
    client.close();
    await server.close();
  });

  it('pushes run.cancel through a socket held by another API instance', async () => {
    const server = await startTestServer(database);
    const holder = await startTestServer(database);
    try {
      const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
      const client = await TestRunnerClient.connect(holder.port, token);
      client.send(hello());
      await client.next('welcome');
      const runId = await queueRun(testDeps(database.db), userId, runnerId);
      const { attempt } = await client.next('run.assign');
      client.send({
        type: 'run.events',
        runId,
        attempt,
        events: [{ seq: 1, event: startedEvent }],
      });
      await client.next('run.ack');
      const cookie = await sessionCookie(testAuth(database.db), userId);

      const response = await fetch(`http://localhost:${server.port}/rpc/run/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': 'orpc', cookie },
        body: JSON.stringify({ json: { runId } }),
      });

      expect(response.status).toBe(200);
      expect(await client.next('run.cancel')).toEqual({ type: 'run.cancel', runId, attempt });
      client.close();
    } finally {
      await holder.close();
      await server.close();
    }
  });
});

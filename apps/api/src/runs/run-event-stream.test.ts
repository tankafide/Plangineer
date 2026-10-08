import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunEvent } from '@plangineer/contracts';
import { sessionCookie, storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  appendRunnerEvents,
  messageEvent,
  queueRun,
  startedEvent,
  succeededEvent,
} from '../test/runs.ts';
import { createTestApp, startTestServer } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import type { RunningServer } from '../server.ts';
import { claimRuns } from './dispatch.ts';

/** Reads an SSE response, collecting its run events until the stream ends or `until` holds. */
async function readStream(
  response: Response,
  until: (events: RunEvent[]) => boolean = () => false,
): Promise<{ events: RunEvent[]; ids: string[]; comments: number; ended: boolean }> {
  const events: RunEvent[] = [];
  const ids: string[] = [];
  let comments = 0;
  let buffer = '';
  // The server writes LF-separated SSE, so blank lines split messages.
  const parse = (block: string) => {
    const fields = new Map<string, string>();
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) comments += 1;
      else fields.set(line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2));
    }
    if (!fields.has('data')) return;
    expect(fields.get('event')).toBe('run-event');
    ids.push(fields.get('id') ?? '');
    events.push(RunEvent.parse(JSON.parse(fields.get('data') ?? '')));
  };
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('The response has no body');
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { events, ids, comments, ended: true };
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) parse(block);
    if (until(events)) {
      await reader.cancel();
      return { events, ids, comments, ended: false };
    }
  }
}

describe('run event stream', () => {
  let database: TestDatabase;
  let server: RunningServer;
  let userId: string;
  let runnerId: string;
  let cookie: string;
  const deps = () => testDeps(database.db);

  beforeAll(async () => {
    database = await createTestDatabase();
    server = await startTestServer(database);
    userId = (await storeUser(testAuth(database.db))).id;
    runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 16 });
    cookie = await sessionCookie(testAuth(database.db), userId);
  });

  afterAll(async () => {
    await server.close();
    await database.drop();
  });

  const open = (runId: string, headers: Record<string, string> = {}) =>
    fetch(`http://localhost:${server.port}/api/runs/${runId}/events`, {
      headers: { cookie, ...headers },
    });

  async function runningRun() {
    const runId = await queueRun(deps(), userId, runnerId);
    await claimRuns(deps(), runnerId);
    await appendRunnerEvents(deps(), runId, [startedEvent]);
    return runId;
  }

  it('sends the backlog after Last-Event-ID with no gap or repeat, then live events', async () => {
    const runId = await runningRun();
    await appendRunnerEvents(
      deps(),
      runId,
      [messageEvent('4'), messageEvent('5'), messageEvent('6')],
      2,
    );

    const response = await open(runId, { 'last-event-id': '5' });
    const reading = readStream(response);
    await appendRunnerEvents(deps(), runId, [messageEvent('7'), succeededEvent], 5);
    const { events, ids, ended } = await reading;

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map((event) => event.id)).toEqual([6, 7, 8]);
    expect(ids).toEqual(['6', '7', '8']);
    expect(ended).toBe(true);
  });

  it('serves two streams on one run with one read per notification', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });
    const own = await startTestServer(database, {}, logger);
    try {
      const runId = await runningRun();
      const openOwn = () =>
        fetch(`http://localhost:${own.port}/api/runs/${runId}/events`, { headers: { cookie } });
      const seen = { first: 0, second: 0 };
      const first = readStream(await openOwn(), (events) => {
        seen.first = events.length;
        return events.length === 4;
      });
      const second = readStream(await openOwn(), (events) => {
        seen.second = events.length;
        return events.length === 4;
      });
      // Both streams have sent their backlog, so the next event can only come from the tail.
      await vi.waitFor(() => expect(seen).toEqual({ first: 3, second: 3 }));
      const reads = () =>
        lines.filter((line) => line.includes('Run events tail read') && !line.includes('"count":0'))
          .length;

      await appendRunnerEvents(deps(), runId, [messageEvent()], 2);
      const [a, b] = await Promise.all([first, second]);

      expect(a.events.map((event) => event.id)).toEqual([1, 2, 3, 4]);
      expect(b.events.map((event) => event.id)).toEqual([1, 2, 3, 4]);
      expect(reads()).toBe(1);
    } finally {
      await own.close();
    }
  });

  it('sends the backlog of a finished run and ends', async () => {
    const runId = await runningRun();
    await appendRunnerEvents(deps(), runId, [succeededEvent], 2);

    const { events, ended } = await readStream(await open(runId));

    expect(events.map((event) => event.type)).toEqual([
      'run.queued',
      'run.leased',
      'run.started',
      'run.succeeded',
    ]);
    expect(ended).toBe(true);
  });

  it('answers 401 with no session', async () => {
    const runId = await runningRun();

    expect((await open(runId, { cookie: '' })).status).toBe(401);
  });

  it('answers 404 for a run id that is not a uuid', async () => {
    expect((await open('not-a-run')).status).toBe(404);
  });

  it("answers 404 for another user's run", async () => {
    const other = await storeUser(testAuth(database.db));
    const otherRunner = await storeRunner(database.db, { userId: other.id });
    const runId = await queueRun(deps(), other.id, otherRunner);

    expect((await open(runId)).status).toBe(404);
  });

  it.each(['abc', '-1', '1.5', ''])('answers 400 for Last-Event-ID %j', async (lastEventId) => {
    const runId = await runningRun();

    expect((await open(runId, { 'last-event-id': lastEventId })).status).toBe(400);
  });
});

describe('run event stream keepalive', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await database.drop();
  });

  it('sends a comment line every SSE_KEEPALIVE_INTERVAL_MS on an idle stream', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { app, auth, close } = await createTestApp(database);
    const userId = (await storeUser(auth)).id;
    const runId = await queueRun(
      testDeps(database.db),
      userId,
      await storeRunner(database.db, { userId }),
    );
    const response = await app.request(`/api/runs/${runId}/events`, {
      headers: { cookie: await sessionCookie(auth, userId) },
    });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('The response has no body');
    const decoder = new TextDecoder();
    const backlog = decoder.decode((await reader.read()).value);

    vi.advanceTimersByTime(15_000);
    const first = decoder.decode((await reader.read()).value);
    vi.advanceTimersByTime(15_000);
    const second = decoder.decode((await reader.read()).value);

    expect(backlog).toContain('event: run-event');
    expect(first).toBe(': keepalive\n\n');
    expect(second).toBe(': keepalive\n\n');
    await reader.cancel();
    await close();
  });
});

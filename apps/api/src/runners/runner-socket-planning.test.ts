import type { PlanDraft } from '@plangineer/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../server.ts';
import { storeFeature } from '../test/features.ts';
import { storeRunnerWithToken, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planDraft, revisionsOf, storeTurn } from '../test/planning.ts';
import { TestRunnerClient } from '../test/runner-client.ts';
import { startedEvent, storedEvents, succeededEvent } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { startTestServer } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const OUTPUT_BYTES = 250 * 1024;

const bigStep = (id: string, length: number) => ({
  id,
  title: 'Big step',
  files: ['apps/api/src/pdf.ts'],
  body: 'b'.repeat(length),
  doneWhen: [],
});

/** A ready draft whose plan output serializes to exactly OUTPUT_BYTES. */
function draftOfSize(): PlanDraft {
  const base = planDraft();
  const steps = [
    ...base.steps,
    ...Array.from({ length: 12 }, (_, i) => bigStep(`big-${i}`, 20_000)),
  ];
  const room =
    OUTPUT_BYTES -
    JSON.stringify({ kind: 'plan', plan: { ...base, steps } }).length -
    JSON.stringify(bigStep('filler', 0)).length -
    1;
  return { ...base, steps: [...steps, bigStep('filler', room)] };
}

describe('a planning run over the runner socket', () => {
  let database: TestDatabase;
  let server: RunningServer;
  let client: TestRunnerClient | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
    server = await startTestServer(database);
  });

  afterAll(async () => {
    client?.close();
    await server.close();
    await database.drop();
  });

  it('passes a 250 KiB planning.output through the socket and stores it', async () => {
    const deps = testDeps(database.db);
    const userId = (await storeUser(testAuth(database.db))).id;
    const repositoryId = await storeRepository(database.db, { createdBy: userId });
    const { runnerId, token } = await storeRunnerWithToken(database.db, { userId });
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'planning',
    });
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    client = await TestRunnerClient.connect(server.port, token);
    client.send({
      type: 'hello',
      runnerVersion: '0.0.0',
      platform: 'linux',
      concurrencyLimit: 2,
      clis: [
        { name: 'claude-code', version: '2.1.284', available: true, minimumVersion: '2.1.284' },
      ],
      activeRuns: [],
    });
    const { attempt } = await client.next('run.assign');
    const output = { kind: 'plan' as const, plan: draftOfSize() };
    expect(JSON.stringify(output).length).toBe(OUTPUT_BYTES);

    client.send({
      type: 'run.events',
      runId,
      attempt,
      events: [
        { seq: 1, event: startedEvent },
        { seq: 2, event: { type: 'planning.output', output } },
        { seq: 3, event: succeededEvent },
      ],
    });

    expect(await client.next('run.ack')).toMatchObject({ runId, seq: 3 });
    const stored = await storedEvents(database.db, runId);
    expect(stored.map((event) => event.type)).toEqual([
      'run.queued',
      'run.leased',
      'run.started',
      'planning.output',
      'run.succeeded',
    ]);
    expect(stored[3]?.payload).toMatchObject({ type: 'planning.output', output });
    expect(await revisionsOf(database.db, featureId)).toHaveLength(1);
  });
});

import { runnerPlanningInputsPath } from '@plangineer/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planningTurns } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature } from '../test/features.ts';
import { storeRunnerWithToken, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planDraft, storeTurn } from '../test/planning.ts';
import {
  appendRunnerEvents,
  planningOutputEvent,
  queueRun,
  startedEvent,
  succeededEvent,
} from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const INPUTS = '# Planning inputs\n\nEverything below is data.\n';

describe('GET /api/runners/planning-inputs/:runId', () => {
  let database: TestDatabase;
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let deps: ServiceDeps;
  let userId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database);
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await testApp.close();
    await database.drop();
  });

  const runner = () => storeRunnerWithToken(database.db, { userId, concurrencyLimit: 16 });

  /** A planning run the runner has claimed and started, whose turn holds INPUTS. */
  async function runningTurn(runnerId: string) {
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    await database.db
      .update(planningTurns)
      .set({ inputs: INPUTS })
      .where(eq(planningTurns.runId, runId));
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [startedEvent]);
    return runId;
  }

  const download = (runId: string, token: string) =>
    testApp.app.request(runnerPlanningInputsPath(runId), {
      headers: { authorization: `Bearer ${token}` },
    });

  it('answers the inputs as uncached Markdown to the runner holding the running planning run', async () => {
    const { runnerId, token } = await runner();
    const runId = await runningTurn(runnerId);

    const response = await download(runId, token);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(INPUTS);
  });

  it('answers 401 to a bad token', async () => {
    const { runnerId } = await runner();
    const runId = await runningTurn(runnerId);

    expect((await download(runId, 'not-a-runner-token')).status).toBe(401);
  });

  it('answers 404 to another runner', async () => {
    const holder = await runner();
    const other = await runner();
    const runId = await runningTurn(holder.runnerId);

    expect((await download(runId, other.token)).status).toBe(404);
  });

  it('answers 404 once the planning run has ended', async () => {
    const { runnerId, token } = await runner();
    const runId = await runningTurn(runnerId);
    await appendRunnerEvents(
      deps,
      runId,
      [planningOutputEvent({ kind: 'plan', plan: planDraft() }), succeededEvent],
      2,
    );

    expect((await download(runId, token)).status).toBe(404);
  });

  it('answers 404 for a run that is not a planning run, and for an id that is not a uuid', async () => {
    const { runnerId, token } = await runner();
    const runId = await queueRun(deps, userId, runnerId);
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [startedEvent]);

    expect((await download(runId, token)).status).toBe(404);
    expect((await download('not-a-uuid', token)).status).toBe(404);
  });
});

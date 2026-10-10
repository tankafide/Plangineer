import type { FeatureState, PlanBody, RunMode, RunnerRunEventBody } from '@plangineer/contracts';
import { asc, eq } from 'drizzle-orm';
import { planQuestions, runners } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { TurnSpec } from '../planning/planning-inputs.ts';
import type { InitialContext } from '../rpc/context.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature } from './features.ts';
import { storeRunner, storeUser, testAuth } from './fixtures.ts';
import { finishTurn, planBody, questionsOutput, storeRevision, storeTurn } from './planning.ts';
import { appendRunnerEvents, startedEvent } from './runs.ts';

const failedEvent: RunnerRunEventBody = {
  type: 'run.failed',
  reason: 'agent_error',
  message: 'The agent stopped.',
  exitCode: 1,
  stderrTail: [],
};

/** Builders for the plan procedure tests, over one test database and repository. */
export function planScenarios(deps: ServiceDeps, repositoryId: string) {
  const { db } = deps;

  /** A member with a runner, and the context their procedures run in. */
  async function member() {
    const stored = await storeUser(testAuth(db), { role: 'member' });
    const runnerId = await storeRunner(db, { userId: stored.id, concurrencyLimit: 16 });
    const context: InitialContext = {
      ...deps,
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, runnerId, context };
  }

  const revoke = (runnerId: string) =>
    db
      .update(runners)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(runners.id, runnerId));

  const feature = (
    userId: string,
    { state = 'planning', runMode = 'manual' }: { state?: FeatureState; runMode?: RunMode } = {},
  ) => storeFeature(db, { authorId: userId, repositoryId, state, runMode });

  /** Stores the engineer's revision with the given number and body. */
  async function revision(
    featureId: string,
    userId: string,
    number = 1,
    body = planBody(repositoryId),
  ) {
    await storeRevision(db, { featureId, body, number, authorId: userId });
    return body;
  }

  /** A finished questions turn of the feature, and its question ids in order. */
  async function askedQuestions(featureId: string, userId: string, runnerId: string, count = 2) {
    const { turnId, runId } = await storeTurn(deps, { featureId, userId, runnerId });
    await finishTurn(deps, runnerId, runId, questionsOutput(count));
    const rows = await db
      .select({ id: planQuestions.id })
      .from(planQuestions)
      .where(eq(planQuestions.turnId, turnId))
      .orderBy(asc(planQuestions.position));
    return { turnId, questionIds: rows.map((row) => row.id) };
  }

  /** A guided turn whose run is still queued. */
  const queuedTurn = (featureId: string, userId: string, runnerId: string) =>
    storeTurn(deps, { featureId, userId, runnerId });

  /** A turn of the given spec whose run failed. */
  async function failedTurn(
    featureId: string,
    userId: string,
    runnerId: string,
    spec: TurnSpec = { kind: 'guided' },
  ) {
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId, spec });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [startedEvent, failedEvent]);
    return runId;
  }

  /** A body whose first step's rows are stale, so it is not ready. */
  const staleBody = (): PlanBody => {
    const body = planBody(repositoryId);
    return { ...body, coverage: body.coverage.map((row) => ({ ...row, stale: true })) };
  };

  return {
    member,
    revoke,
    feature,
    revision,
    askedQuestions,
    queuedTurn,
    failedTurn,
    staleBody,
  };
}

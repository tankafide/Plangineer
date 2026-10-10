import {
  type FeatureState,
  type PageInput,
  PlanningTurn,
  type PlanRevision,
  type PlanRevisionSummary,
  PlanWorkspace,
  type RunMode,
} from '@plangineer/contracts';
import {
  acceptanceCriteria,
  AUTO_DRAFTS_MAX,
  isReady,
  planReadiness,
  sectionStatuses,
  uncleanDrafts,
  workflowSettingsFor,
} from '@plangineer/domain';
import type { Executor } from '../db/client.ts';
import { toPage } from '../lib/page.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { wakeRunner } from '../runners/runner-repository.ts';
import { queueAutoLoopTurn } from './planning-apply.ts';
import { findFeatureForAuthor, findPlanningInputsForRunner } from './planning-repository.ts';
import { openQuestions, readPlanState, turnRunning } from './plan-state.ts';
import {
  findRevisionByNumber,
  findRevisionSources,
  listRecentRevisions,
  listRevisionSummaries,
  type StoredRevision,
} from './revision-repository.ts';

async function toPlanRevision(executor: Executor, stored: StoredRevision): Promise<PlanRevision> {
  return {
    id: stored.id,
    number: stored.number,
    source: stored.source,
    createdAt: stored.createdAt.toISOString(),
    body: stored.body,
    acceptanceCriteria: acceptanceCriteria(stored.body),
    ...(await findRevisionSources(executor, stored.id)),
  };
}

/**
 * The feature's plan workspace: the latest revision and turn, the questions and decisions that
 * show, and the readiness, section statuses and Auto loop stop the domain derives (D12).
 */
async function readWorkspace(
  executor: Executor,
  featureId: string,
  feature: { state: FeatureState; runMode: RunMode },
): Promise<PlanWorkspace> {
  const state = await readPlanState(executor, featureId);
  const recent = await listRecentRevisions(executor, featureId, AUTO_DRAFTS_MAX);
  const open = openQuestions(state);
  const body = state.revision === undefined ? null : state.revision.body;
  const readiness = planReadiness(body, open.length);
  const drafts = recent.map((revision) => ({
    turnKind: revision.turnKind,
    ready: isReady(planReadiness(revision.body, 0)),
  }));
  return PlanWorkspace.parse({
    featureId,
    featureState: feature.state,
    runMode: feature.runMode,
    workflowSettings: workflowSettingsFor(feature.runMode),
    revision: state.revision === undefined ? null : await toPlanRevision(executor, state.revision),
    turn: state.turn === undefined ? null : PlanningTurn.parse(state.turn),
    questions: state.questions,
    decisions: state.decisions,
    readiness,
    sections: sectionStatuses(
      body,
      open.map((question) => question.section),
      readiness,
    ),
    autoLoopStopped:
      feature.runMode === 'auto_loop' &&
      !turnRunning(state) &&
      uncleanDrafts(drafts) >= AUTO_DRAFTS_MAX,
  });
}

/** The workspace of a feature the author just changed. It exists, since the caller locked it. */
export async function readWorkspaceAfterWrite(
  { db }: ServiceDeps,
  userId: string,
  featureId: string,
): Promise<PlanWorkspace> {
  const feature = await findFeatureForAuthor(db, userId, featureId);
  if (feature === undefined) throw new Error(`Feature ${featureId} vanished`);
  return readWorkspace(db, featureId, feature);
}

export async function getPlan(
  { db }: ServiceDeps,
  userId: string,
  featureId: string,
): Promise<Result<PlanWorkspace, 'NOT_FOUND'>> {
  const feature = await findFeatureForAuthor(db, userId, featureId);
  if (feature === undefined) return fail('NOT_FOUND');
  return ok(await readWorkspace(db, featureId, feature));
}

/** One page of the feature's revisions, newest first by id. */
export async function listPlanRevisions(
  { db }: ServiceDeps,
  userId: string,
  { featureId, ...page }: PageInput & { featureId: string },
): Promise<Result<{ items: PlanRevisionSummary[]; nextCursor: string | null }, 'NOT_FOUND'>> {
  if ((await findFeatureForAuthor(db, userId, featureId)) === undefined) return fail('NOT_FOUND');
  return ok(toPage(await listRevisionSummaries(db, featureId, page), page.limit));
}

export async function getPlanRevision(
  { db }: ServiceDeps,
  userId: string,
  featureId: string,
  number: number,
): Promise<Result<PlanRevision, 'NOT_FOUND'>> {
  if ((await findFeatureForAuthor(db, userId, featureId)) === undefined) return fail('NOT_FOUND');
  const stored = await findRevisionByNumber(db, featureId, number);
  return stored === undefined ? fail('NOT_FOUND') : ok(await toPlanRevision(db, stored));
}

/** A planning run's inputs, when the runner holds the run leased or running. */
export function getPlanningInputsForRunner({ db }: ServiceDeps, runnerId: string, runId: string) {
  return findPlanningInputsForRunner(db, runnerId, runId);
}

/**
 * Queues an Auto loop's next draft after a planning run ended, and wakes its runner. It never
 * throws, since every run end calls it.
 */
export async function advancePlanningOfRun(
  { db, env, logger }: ServiceDeps,
  runId: string,
): Promise<void> {
  try {
    const options = { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger };
    const runnerId = await db.transaction((tx) => queueAutoLoopTurn(tx, options, runId));
    if (runnerId !== undefined) await wakeRunner(db, runnerId);
  } catch (error) {
    logger.error({ err: error, runId }, 'Planning could not advance after its run ended');
  }
}

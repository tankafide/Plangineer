import {
  PlanningJob,
  type PlanningTurn,
  type PlanningTurnKind,
  type PlanSection,
  type SectionAction,
} from '@plangineer/contracts';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import {
  contextFiles,
  featureRepositories,
  features,
  planningTurnContextFiles,
  planningTurns,
  prePlanningTasks,
  repositories,
  runs,
} from '../db/schema.ts';

/** One intake, one exploration and ten research tasks, each with one context file. */
const CONTEXT_FILES_MAX = 12;

export interface PlanningSubject {
  title: string;
  description: string;
  repository: { id: string; owner: string; name: string; defaultBranch: string };
}

/** The feature's title, description and its one repository, which a turn plans against. */
export async function findPlanningSubject(
  executor: Executor,
  featureId: string,
): Promise<PlanningSubject | undefined> {
  const [row] = await executor
    .select({
      title: features.title,
      description: features.description,
      repository: {
        id: repositories.id,
        owner: repositories.owner,
        name: repositories.name,
        defaultBranch: repositories.defaultBranch,
      },
    })
    .from(features)
    .innerJoin(featureRepositories, eq(featureRepositories.featureId, features.id))
    .innerJoin(repositories, eq(repositories.id, featureRepositories.repositoryId))
    .where(eq(features.id, featureId))
    .orderBy(asc(featureRepositories.id))
    .limit(1);
  return row;
}

/** The author's feature's state and run mode, read without a lock. */
export async function findFeatureForAuthor(
  executor: Executor,
  authorId: string,
  featureId: string,
) {
  const [row] = await executor
    .select({ state: features.state, runMode: features.runMode })
    .from(features)
    .where(and(eq(features.id, featureId), eq(features.authorId, authorId)));
  return row;
}

/**
 * Up to limit Auto loop features left in plan_ready, oldest first, for the sweeper to start
 * their planning. Read through features_auto_plan_ready_idx.
 */
export async function findAutoPlanReadyFeatures(
  executor: Executor,
  limit: number,
): Promise<string[]> {
  const rows = await executor
    .select({ id: features.id })
    .from(features)
    .where(and(eq(features.state, 'plan_ready'), eq(features.runMode, 'auto_loop')))
    .orderBy(asc(features.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** The feature's ticked context files, in task order. */
export async function listTickedContextFiles(
  executor: Executor,
  featureId: string,
): Promise<{ id: string; title: string; content: string }[]> {
  return executor
    .select({ id: contextFiles.id, title: contextFiles.title, content: contextFiles.content })
    .from(contextFiles)
    .innerJoin(prePlanningTasks, eq(prePlanningTasks.id, contextFiles.taskId))
    .where(and(eq(prePlanningTasks.featureId, featureId), eq(contextFiles.ticked, true)))
    .orderBy(asc(prePlanningTasks.id))
    .limit(CONTEXT_FILES_MAX);
}

/** The commit the feature's first planning run checked out, once one has recorded it (D7). */
export async function findFirstPlanningCommit(
  executor: Executor,
  featureId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ commit: runs.commit })
    .from(planningTurns)
    .innerJoin(runs, eq(runs.id, planningTurns.runId))
    .where(and(eq(planningTurns.featureId, featureId), isNotNull(runs.commit)))
    .orderBy(asc(planningTurns.id))
    .limit(1);
  return row?.commit ?? undefined;
}

export interface NewTurn {
  featureId: string;
  kind: PlanningTurnKind;
  section: PlanSection | null;
  action: SectionAction | null;
  stepId: string | null;
  instruction: string | null;
  job: PlanningJob;
  inputs: string;
  runId: string;
}

/** Inserts a turn with the context files it read, each with its title now. */
export async function insertTurn(
  tx: Transaction,
  turn: NewTurn,
  files: { id: string; title: string }[],
): Promise<string> {
  const [row] = await tx
    .insert(planningTurns)
    .values({ ...turn, job: PlanningJob.parse(turn.job) })
    .returning({ id: planningTurns.id });
  if (row === undefined) throw new Error('Planning turn insert returned no row');
  if (files.length > 0) {
    await tx
      .insert(planningTurnContextFiles)
      .values(files.map((file) => ({ turnId: row.id, contextFileId: file.id, title: file.title })));
  }
  return row.id;
}

const turnColumns = {
  id: planningTurns.id,
  kind: planningTurns.kind,
  section: planningTurns.section,
  action: planningTurns.action,
  stepId: planningTurns.stepId,
  instruction: planningTurns.instruction,
  runId: planningTurns.runId,
  status: runs.status,
  createdAt: planningTurns.createdAt,
};

export type LatestTurn = PlanningTurn & { instruction: string | null };

/** The feature's newest turn with its run's status. */
export async function findLatestTurn(
  executor: Executor,
  featureId: string,
): Promise<LatestTurn | undefined> {
  const [row] = await executor
    .select(turnColumns)
    .from(planningTurns)
    .innerJoin(runs, eq(runs.id, planningTurns.runId))
    .where(eq(planningTurns.featureId, featureId))
    .orderBy(desc(planningTurns.id))
    .limit(1);
  return row === undefined ? undefined : { ...row, createdAt: row.createdAt.toISOString() };
}

export interface TurnOfRun {
  id: string;
  featureId: string;
  kind: PlanningTurnKind;
  section: PlanSection | null;
  stepId: string | null;
  job: PlanningJob;
  runnerId: string;
  commit: string | null;
}

/** The turn a planning run serves, with the run's runner and commit. */
export async function findTurnOfRun(
  executor: Executor,
  runId: string,
): Promise<TurnOfRun | undefined> {
  const [row] = await executor
    .select({
      id: planningTurns.id,
      featureId: planningTurns.featureId,
      kind: planningTurns.kind,
      section: planningTurns.section,
      stepId: planningTurns.stepId,
      job: planningTurns.job,
      runnerId: runs.runnerId,
      commit: runs.commit,
    })
    .from(planningTurns)
    .innerJoin(runs, eq(runs.id, planningTurns.runId))
    .where(eq(planningTurns.runId, runId));
  return row === undefined ? undefined : { ...row, job: PlanningJob.parse(row.job) };
}

/** A planning run's inputs, when the runner holds the run leased or running. */
export async function findPlanningInputsForRunner(
  executor: Executor,
  runnerId: string,
  runId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ inputs: planningTurns.inputs })
    .from(planningTurns)
    .innerJoin(runs, eq(runs.id, planningTurns.runId))
    .where(
      and(
        eq(planningTurns.runId, runId),
        eq(runs.runnerId, runnerId),
        inArray(runs.status, ['leased', 'running']),
      ),
    );
  return row?.inputs;
}

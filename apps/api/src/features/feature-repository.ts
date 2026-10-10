import {
  ATTACHMENTS_MAX,
  ContextFileSummary,
  FeatureDetail,
  type FeatureState,
  FeatureSummary,
  type PageInput,
  PrePlanningJob,
  type PrePlanningTaskKind,
  RESEARCH_TOPICS_MAX,
  type RunMode,
  type RunStatus,
} from '@plangineer/contracts';
import { workflowSettingsFor } from '@plangineer/domain';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import {
  contextFiles,
  featureAttachments,
  featureRepositories,
  features,
  prePlanningTasks,
  repositories,
  runs,
} from '../db/schema.ts';

/** One intake, one exploration and one research task per topic. */
const TASKS_MAX = 2 + RESEARCH_TOPICS_MAX;
/** A feature involves one repository until several are built. */
const REPOSITORIES_MAX = 1;

interface NewFeature {
  authorId: string;
  title: string;
  description: string;
  ticketUrl: string | null;
  exploreCodebase: boolean;
  runMode: RunMode;
}

/** Inserts a feature in pre_planning with the one repository it involves. */
export async function insertFeature(
  tx: Transaction,
  feature: NewFeature,
  repositoryId: string,
): Promise<string> {
  const [row] = await tx
    .insert(features)
    .values({ ...feature, state: 'pre_planning' })
    .returning({ id: features.id });
  if (row === undefined) throw new Error('Feature insert returned no row');
  await tx.insert(featureRepositories).values({ featureId: row.id, repositoryId });
  return row.id;
}

interface NewTask {
  featureId: string;
  kind: PrePlanningTaskKind;
  repositoryId: string;
  topic: string | null;
  job: PrePlanningJob;
  runId: string;
}

export async function insertTask(tx: Transaction, task: NewTask): Promise<void> {
  await tx.insert(prePlanningTasks).values({ ...task, job: PrePlanningJob.parse(task.job) });
}

const summaryColumns = {
  id: features.id,
  title: features.title,
  state: features.state,
  runMode: features.runMode,
  createdAt: features.createdAt,
};

function toSummary(row: { createdAt: Date } & Omit<FeatureSummary, 'createdAt'>) {
  return FeatureSummary.parse({ ...row, createdAt: row.createdAt.toISOString() });
}

/** One page of the author's features, id descending, with one extra row to tell if more exist. */
export async function listFeaturesForAuthor(
  executor: Executor,
  authorId: string,
  { cursor, limit }: PageInput,
): Promise<FeatureSummary[]> {
  const rows = await executor
    .select(summaryColumns)
    .from(features)
    .where(
      and(
        eq(features.authorId, authorId),
        cursor === undefined ? undefined : lt(features.id, cursor),
      ),
    )
    .orderBy(desc(features.id))
    .limit(limit + 1);
  return rows.map(toSummary);
}

/** The author's feature with its repositories, attachments, tasks and context files. */
export async function findFeatureDetail(
  executor: Executor,
  authorId: string,
  featureId: string,
): Promise<FeatureDetail | undefined> {
  const [feature] = await executor
    .select({
      ...summaryColumns,
      description: features.description,
      ticketUrl: features.ticketUrl,
      exploreCodebase: features.exploreCodebase,
      updatedAt: features.updatedAt,
    })
    .from(features)
    .where(and(eq(features.id, featureId), eq(features.authorId, authorId)));
  if (feature === undefined) return undefined;
  const [involved, attachments, tasks, files] = await Promise.all([
    executor
      .select({ id: repositories.id, owner: repositories.owner, name: repositories.name })
      .from(featureRepositories)
      .innerJoin(repositories, eq(repositories.id, featureRepositories.repositoryId))
      .where(eq(featureRepositories.featureId, featureId))
      .orderBy(asc(featureRepositories.id))
      .limit(REPOSITORIES_MAX),
    executor
      .select({
        id: featureAttachments.id,
        name: featureAttachments.name,
        mediaType: featureAttachments.mediaType,
        sizeBytes: featureAttachments.sizeBytes,
      })
      .from(featureAttachments)
      .where(eq(featureAttachments.featureId, featureId))
      .orderBy(asc(featureAttachments.id))
      .limit(ATTACHMENTS_MAX),
    executor
      .select({
        id: prePlanningTasks.id,
        kind: prePlanningTasks.kind,
        topic: prePlanningTasks.topic,
        runId: prePlanningTasks.runId,
        repository: { id: repositories.id, owner: repositories.owner, name: repositories.name },
        status: runs.status,
        commit: runs.commit,
      })
      .from(prePlanningTasks)
      .innerJoin(repositories, eq(repositories.id, prePlanningTasks.repositoryId))
      .innerJoin(runs, eq(runs.id, prePlanningTasks.runId))
      .where(eq(prePlanningTasks.featureId, featureId))
      .orderBy(asc(prePlanningTasks.id))
      .limit(TASKS_MAX),
    executor
      .select({
        id: contextFiles.id,
        taskId: contextFiles.taskId,
        title: contextFiles.title,
        ticked: contextFiles.ticked,
        updatedAt: contextFiles.updatedAt,
      })
      .from(contextFiles)
      .innerJoin(prePlanningTasks, eq(prePlanningTasks.id, contextFiles.taskId))
      .where(eq(prePlanningTasks.featureId, featureId))
      .orderBy(asc(prePlanningTasks.id))
      .limit(TASKS_MAX),
  ]);
  return FeatureDetail.parse({
    ...feature,
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
    workflowSettings: workflowSettingsFor(feature.runMode),
    repositories: involved,
    attachments,
    tasks,
    contextFiles: files.map((file) =>
      ContextFileSummary.parse({ ...file, updatedAt: file.updatedAt.toISOString() }),
    ),
  });
}

/** Sets the author's feature's run mode, and returns whether the feature exists. */
export async function updateFeatureRunMode(
  executor: Executor,
  authorId: string,
  featureId: string,
  runMode: RunMode,
): Promise<boolean> {
  const rows = await executor
    .update(features)
    .set({ runMode })
    .where(and(eq(features.id, featureId), eq(features.authorId, authorId)))
    .returning({ id: features.id });
  return rows.length > 0;
}

/** Locks the author's feature row, which every state change takes first. */
export async function lockFeatureForAuthor(
  tx: Transaction,
  authorId: string,
  featureId: string,
): Promise<{ state: FeatureState; runMode: RunMode } | undefined> {
  const [row] = await tx
    .select({ state: features.state, runMode: features.runMode })
    .from(features)
    .where(and(eq(features.id, featureId), eq(features.authorId, authorId)))
    .for('update');
  return row;
}

/** Locks a feature row for the run-end advance, whoever its author is. */
export async function lockFeature(
  tx: Transaction,
  featureId: string,
): Promise<FeatureState | undefined> {
  const [row] = await tx
    .select({ state: features.state })
    .from(features)
    .where(eq(features.id, featureId))
    .for('update');
  return row?.state;
}

export async function updateFeatureState(
  tx: Transaction,
  featureId: string,
  state: FeatureState,
): Promise<void> {
  await tx.update(features).set({ state }).where(eq(features.id, featureId));
}

/** The status of each task's run in the feature. */
export async function listTaskRunStatuses(
  executor: Executor,
  featureId: string,
): Promise<RunStatus[]> {
  const rows = await executor
    .select({ status: runs.status })
    .from(prePlanningTasks)
    .innerJoin(runs, eq(runs.id, prePlanningTasks.runId))
    .where(eq(prePlanningTasks.featureId, featureId))
    .orderBy(asc(prePlanningTasks.id))
    .limit(TASKS_MAX);
  return rows.map((row) => row.status);
}

/** The feature a pre-planning run serves, or undefined for any other run. */
export async function findFeatureIdOfRun(
  executor: Executor,
  runId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ featureId: prePlanningTasks.featureId })
    .from(prePlanningTasks)
    .where(eq(prePlanningTasks.runId, runId));
  return row?.featureId;
}

/** Up to limit features still in pre_planning, oldest first, for the sweeper's repair. */
export async function findPrePlanningFeatures(
  executor: Executor,
  limit: number,
): Promise<string[]> {
  const rows = await executor
    .select({ id: features.id })
    .from(features)
    .where(eq(features.state, 'pre_planning'))
    .orderBy(asc(features.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

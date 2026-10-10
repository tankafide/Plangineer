import {
  AttachmentMediaType,
  type FeatureCreateInput,
  type FeatureDetail,
  type FeatureUpdateInput,
  type PageInput,
  PrePlanningJob,
  type PrePlanningTaskKind,
} from '@plangineer/contracts';
import { featureTitle, pickRunner, startPlanning } from '@plangineer/domain';
import type { z } from 'zod';
import type { Transaction } from '../db/client.ts';
import { toPage } from '../lib/page.ts';
import { err, fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { findRepositoryBranch } from '../repositories/repository-repository.ts';
import {
  listActiveRunnersForUser,
  lockRunnerForUser,
  wakeRunner,
} from '../runners/runner-repository.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { insertRun } from '../runs/run-repository.ts';
import {
  findAttachmentForRunner,
  insertAttachments,
  type NewAttachment,
} from './attachment-repository.ts';
import {
  findFeatureDetail,
  insertFeature,
  insertTask,
  listFeaturesForAuthor,
  lockFeatureForAuthor,
  updateFeatureRunMode,
  updateFeatureState,
} from './feature-repository.ts';
import { renderTaskInputs, renderTaskPrompt } from './task-files.ts';

type CreateInput = z.output<typeof FeatureCreateInput>;

/** The feature the author just changed. It exists, since the caller found or made it. */
async function readDetail(
  { db }: ServiceDeps,
  authorId: string,
  featureId: string,
): Promise<FeatureDetail> {
  const detail = await findFeatureDetail(db, authorId, featureId);
  if (detail === undefined) throw new Error(`Feature ${featureId} vanished`);
  return detail;
}

interface PlannedTask {
  kind: PrePlanningTaskKind;
  topic: string | null;
}

/** One intake task, one exploration task when asked for, and one research task per topic. */
function plannedTasks(input: CreateInput): PlannedTask[] {
  return [
    { kind: 'intake', topic: null },
    ...(input.exploreCodebase ? [{ kind: 'exploration' as const, topic: null }] : []),
    ...input.researchTopics.map((topic) => ({ kind: 'research' as const, topic })),
  ];
}

async function readAttachments(files: File[]): Promise<NewAttachment[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mediaType: AttachmentMediaType.parse(file.type),
      content: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

/**
 * Picks the viewer's most recently seen runner and locks it, rechecking it is not revoked, so a
 * concurrent revoke orders before or after the whole creation.
 */
async function lockPickedRunner(tx: Transaction, userId: string): Promise<string | undefined> {
  const runnerId = pickRunner(await listActiveRunnersForUser(tx, userId));
  if (runnerId === null) return undefined;
  const runner = await lockRunnerForUser(tx, userId, runnerId);
  return runner === undefined || runner.status === 'revoked' ? undefined : runnerId;
}

/**
 * Stores the feature, its attachments and its tasks, each task with its rendered job and a
 * queued pre_planning run on the picked runner at the repository's stored default branch, in
 * one transaction. Only the intake job lists the attachments. It makes no GitHub call.
 */
export async function createFeature(
  deps: ServiceDeps,
  userId: string,
  input: CreateInput,
): Promise<Result<FeatureDetail, 'NOT_FOUND' | 'RUNNER_REQUIRED'>> {
  const { db, env, logger } = deps;
  const attachments = await readAttachments(input.attachments);
  const created = await db.transaction(async (tx) => {
    const [repositoryId] = input.repositoryIds;
    const repository =
      repositoryId === undefined ? undefined : await findRepositoryBranch(tx, repositoryId);
    if (repository === undefined) return fail('NOT_FOUND');
    const runnerId = await lockPickedRunner(tx, userId);
    if (runnerId === undefined) return fail('RUNNER_REQUIRED');
    const feature = {
      description: input.description,
      ticketUrl: input.ticketUrl ?? null,
    };
    const featureId = await insertFeature(
      tx,
      {
        ...feature,
        authorId: userId,
        title: featureTitle(input.description),
        exploreCodebase: input.exploreCodebase,
        runMode: input.runMode,
      },
      repository.id,
    );
    const stored = await insertAttachments(tx, featureId, attachments);
    for (const task of plannedTasks(input)) {
      const job = PrePlanningJob.parse({
        kind: 'pre_planning',
        task: task.kind,
        repository: { owner: repository.owner, name: repository.name },
        ref: repository.defaultBranch,
        prompt: renderTaskPrompt(task.kind),
        inputs: renderTaskInputs(feature, task),
        attachments: task.kind === 'intake' ? stored : [],
      });
      const runId = await insertRun(tx, userId, {
        kind: 'pre_planning',
        runnerId,
        repository: job.repository,
        ref: job.ref,
        prompt: job.prompt,
      });
      await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], {
        leaseDurationMs: env.RUN_LEASE_DURATION_MS,
        logger,
      });
      await insertTask(tx, { ...task, featureId, repositoryId: repository.id, job, runId });
    }
    return ok({ featureId, runnerId });
  });
  if (!created.ok) return created;
  await wakeRunner(db, created.value.runnerId);
  return ok(await readDetail(deps, userId, created.value.featureId));
}

export async function listFeatures({ db }: ServiceDeps, userId: string, page: PageInput) {
  return toPage(await listFeaturesForAuthor(db, userId, page), page.limit);
}

export async function getFeature(
  { db }: ServiceDeps,
  userId: string,
  featureId: string,
): Promise<Result<FeatureDetail, 'NOT_FOUND'>> {
  const detail = await findFeatureDetail(db, userId, featureId);
  return detail === undefined ? fail('NOT_FOUND') : ok(detail);
}

/** Sets the run mode, in any state. */
export async function changeFeature(
  deps: ServiceDeps,
  userId: string,
  { featureId, runMode }: FeatureUpdateInput,
): Promise<Result<FeatureDetail, 'NOT_FOUND'>> {
  if (!(await updateFeatureRunMode(deps.db, userId, featureId, runMode))) return fail('NOT_FOUND');
  return ok(await readDetail(deps, userId, featureId));
}

/** Moves the feature to planning under its row lock, or answers why it cannot. */
export async function startFeaturePlanning(
  deps: ServiceDeps,
  userId: string,
  featureId: string,
): Promise<Result<FeatureDetail, 'NOT_FOUND' | 'CONFLICT'>> {
  const started = await deps.db.transaction(async (tx) => {
    const feature = await lockFeatureForAuthor(tx, userId, featureId);
    if (feature === undefined) return fail('NOT_FOUND');
    const decision = startPlanning(feature.state, feature.runMode);
    if (!decision.ok) return err('CONFLICT', { reason: decision.reason });
    await updateFeatureState(tx, featureId, decision.state);
    return ok(undefined);
  });
  if (!started.ok) return started;
  return ok(await readDetail(deps, userId, featureId));
}

/** An attachment's bytes, when the runner holds a leased or running intake run of its feature. */
export function getAttachmentForRunner(
  { db }: ServiceDeps,
  runnerId: string,
  attachmentId: string,
) {
  return findAttachmentForRunner(db, runnerId, attachmentId);
}

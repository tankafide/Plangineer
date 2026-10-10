import {
  AttachmentMediaType,
  type FeatureCreateInput,
  type FeatureDetail,
  type FeatureUpdateInput,
  type PageInput,
  PrePlanningJob,
  type PrePlanningTaskKind,
} from '@plangineer/contracts';
import { featureTitle, startPlanning } from '@plangineer/domain';
import type { z } from 'zod';
import { toPage } from '../lib/page.ts';
import { err, fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { findRepositoryBranch } from '../repositories/repository-repository.ts';
import { queueTurn } from '../planning/planning-turns.ts';
import { lockActiveRunner } from '../runners/runner-pick.ts';
import { wakeRunner } from '../runners/runner-repository.ts';
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
  lockFeature,
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
    const runner = await lockActiveRunner(tx, userId);
    if (!runner.ok) return runner;
    const runnerId = runner.value;
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

/** Sets the run mode, in any state. A change to Auto loop starts a plan_ready feature's planning. */
export async function changeFeature(
  deps: ServiceDeps,
  userId: string,
  { featureId, runMode }: FeatureUpdateInput,
): Promise<Result<FeatureDetail, 'NOT_FOUND'>> {
  if (!(await updateFeatureRunMode(deps.db, userId, featureId, runMode))) return fail('NOT_FOUND');
  if (runMode === 'auto_loop') await startAutoPlanning(deps, featureId);
  return ok(await readDetail(deps, userId, featureId));
}

/**
 * Moves the feature to planning under its row lock and queues its first guided turn on the
 * viewer's runner, or answers why it cannot.
 */
export async function startFeaturePlanning(
  deps: ServiceDeps,
  userId: string,
  featureId: string,
): Promise<Result<FeatureDetail, 'NOT_FOUND' | 'CONFLICT' | 'RUNNER_REQUIRED'>> {
  const { db, env, logger } = deps;
  const started = await db.transaction(async (tx) => {
    const feature = await lockFeatureForAuthor(tx, userId, featureId);
    if (feature === undefined) return fail('NOT_FOUND');
    const decision = startPlanning(feature.state, feature.runMode);
    if (!decision.ok) return err('CONFLICT', { reason: decision.reason });
    const runner = await lockActiveRunner(tx, userId);
    if (!runner.ok) return runner;
    await updateFeatureState(tx, featureId, decision.state);
    await queueTurn(
      tx,
      { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger },
      { id: featureId, authorId: userId, runMode: feature.runMode },
      { kind: 'guided' },
      runner.value,
    );
    return runner;
  });
  if (!started.ok) return started;
  await wakeRunner(db, started.value);
  return ok(await readDetail(deps, userId, featureId));
}

/**
 * Starts the planning of an Auto loop feature in plan_ready on its author's runner, as Start
 * planning does for the engineer. It never throws, since run ends, run mode changes and the
 * sweeper call it: a missing runner or a failure is logged, and the next sweep retries it.
 */
export async function startAutoPlanning(deps: ServiceDeps, featureId: string): Promise<void> {
  const { db, env, logger } = deps;
  try {
    const runnerId = await db.transaction(async (tx) => {
      const feature = await lockFeature(tx, featureId);
      if (feature?.state !== 'plan_ready' || feature.runMode !== 'auto_loop') return undefined;
      const runner = await lockActiveRunner(tx, feature.authorId);
      if (!runner.ok) {
        logger.info({ featureId }, 'Auto loop planning waits for a runner');
        return undefined;
      }
      await updateFeatureState(tx, featureId, 'planning');
      await queueTurn(
        tx,
        { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger },
        { id: featureId, authorId: feature.authorId, runMode: feature.runMode },
        { kind: 'guided' },
        runner.value,
      );
      return runner.value;
    });
    if (runnerId !== undefined) await wakeRunner(db, runnerId);
  } catch (error) {
    logger.error({ err: error, featureId }, 'Auto loop planning could not start');
  }
}

/** An attachment's bytes, when the runner holds a leased or running intake run of its feature. */
export function getAttachmentForRunner(
  { db }: ServiceDeps,
  runnerId: string,
  attachmentId: string,
) {
  return findAttachmentForRunner(db, runnerId, attachmentId);
}

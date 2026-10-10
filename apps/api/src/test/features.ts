import type { PrePlanningJob, PrePlanningTaskKind } from '@plangineer/contracts';
import type { Database } from '../db/client.ts';
import { featureRepositories, features, prePlanningTasks } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { insertRun } from '../runs/run-repository.ts';

type FeatureRow = typeof features.$inferInsert;

export function testPrePlanningJob(overrides: Partial<PrePlanningJob> = {}): PrePlanningJob {
  return {
    kind: 'pre_planning',
    task: 'intake',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'Write the feature brief.',
    inputs: '# Inputs',
    attachments: [],
    ...overrides,
  };
}

/** Inserts a pre_planning feature and its one repository row directly. */
export async function storeFeature(
  db: Database,
  { repositoryId, ...overrides }: Partial<FeatureRow> & { authorId: string; repositoryId: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(features)
      .values({
        title: 'Add dark mode',
        description: 'Add dark mode.',
        exploreCodebase: true,
        runMode: 'manual',
        state: 'pre_planning',
        ...overrides,
      })
      .returning({ id: features.id });
    if (row === undefined) throw new Error('Feature insert returned no row');
    await tx.insert(featureRepositories).values({ featureId: row.id, repositoryId });
    return row.id;
  });
}

interface StoredTask {
  taskId: string;
  runId: string;
}

/** Queues a pre_planning run on the runner and stores the task that links it to the feature. */
export async function storeTask(
  deps: ServiceDeps,
  {
    featureId,
    repositoryId,
    userId,
    runnerId,
    kind = 'intake',
    topic = kind === 'research' ? 'Colour contrast' : null,
  }: {
    featureId: string;
    repositoryId: string;
    userId: string;
    runnerId: string;
    kind?: PrePlanningTaskKind;
    topic?: string | null;
  },
): Promise<StoredTask> {
  const job = testPrePlanningJob({ task: kind });
  return deps.db.transaction(async (tx) => {
    const runId = await insertRun(tx, userId, {
      kind: 'pre_planning',
      runnerId,
      repository: job.repository,
      ref: job.ref,
      prompt: job.prompt,
    });
    await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], {
      leaseDurationMs: deps.env.RUN_LEASE_DURATION_MS,
      logger: deps.logger,
    });
    const [row] = await tx
      .insert(prePlanningTasks)
      .values({ featureId, kind, repositoryId, topic, job, runId })
      .returning({ id: prePlanningTasks.id });
    if (row === undefined) throw new Error('Task insert returned no row');
    return { taskId: row.id, runId };
  });
}

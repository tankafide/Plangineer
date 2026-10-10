import { ContextFile, type PrePlanningTaskKind } from '@plangineer/contracts';
import { and, eq, exists, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { contextFiles, features, prePlanningTasks, repositories } from '../db/schema.ts';

function contextFileTitle(task: {
  kind: PrePlanningTaskKind;
  topic: string | null;
  owner: string;
  name: string;
}): string {
  switch (task.kind) {
    case 'intake':
      return 'Feature brief';
    case 'exploration':
      return `Exploration: ${task.owner}/${task.name}`;
    case 'research':
      if (task.topic === null) throw new Error('A research task has no topic');
      return `Research: ${task.topic}`;
    default: {
      const unknownKind: never = task.kind;
      throw new Error(`Unknown task kind ${String(unknownKind)}`);
    }
  }
}

/**
 * Stores a task run's answer as the task's context file, titled for its kind. A repeated call
 * for the same task adds nothing.
 */
export async function insertContextFile(
  tx: Transaction,
  runId: string,
  content: string,
): Promise<void> {
  const [task] = await tx
    .select({
      id: prePlanningTasks.id,
      kind: prePlanningTasks.kind,
      topic: prePlanningTasks.topic,
      owner: repositories.owner,
      name: repositories.name,
    })
    .from(prePlanningTasks)
    .innerJoin(repositories, eq(repositories.id, prePlanningTasks.repositoryId))
    .where(eq(prePlanningTasks.runId, runId));
  if (task === undefined) throw new Error(`Pre-planning run ${runId} has no task`);
  await tx
    .insert(contextFiles)
    .values({ taskId: task.id, title: contextFileTitle(task), content })
    .onConflictDoNothing({ target: contextFiles.taskId });
}

/** True for a context file whose feature the user wrote. A context file reaches it through its task. */
function writtenBy(executor: Executor, userId: string) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(prePlanningTasks)
      .innerJoin(features, eq(features.id, prePlanningTasks.featureId))
      .where(and(eq(prePlanningTasks.id, contextFiles.taskId), eq(features.authorId, userId))),
  );
}

export async function findContextFileForAuthor(
  executor: Executor,
  authorId: string,
  contextFileId: string,
): Promise<ContextFile | undefined> {
  const [row] = await executor
    .select({
      id: contextFiles.id,
      taskId: contextFiles.taskId,
      featureId: features.id,
      title: contextFiles.title,
      content: contextFiles.content,
      ticked: contextFiles.ticked,
      updatedAt: contextFiles.updatedAt,
    })
    .from(contextFiles)
    .innerJoin(prePlanningTasks, eq(prePlanningTasks.id, contextFiles.taskId))
    .innerJoin(features, eq(features.id, prePlanningTasks.featureId))
    .where(and(eq(contextFiles.id, contextFileId), eq(features.authorId, authorId)));
  return row === undefined
    ? undefined
    : ContextFile.parse({ ...row, updatedAt: row.updatedAt.toISOString() });
}

interface ContextFileChanges {
  title?: string | undefined;
  content?: string | undefined;
  ticked?: boolean | undefined;
}

/** Sets the given fields of the author's context file, and returns whether it exists. */
export async function updateContextFile(
  executor: Executor,
  authorId: string,
  contextFileId: string,
  changes: ContextFileChanges,
): Promise<boolean> {
  const rows = await executor
    .update(contextFiles)
    .set(changes)
    .where(and(eq(contextFiles.id, contextFileId), writtenBy(executor, authorId)))
    .returning({ id: contextFiles.id });
  return rows.length > 0;
}

/** Deletes the author's context file, and returns whether it existed. */
export async function deleteContextFile(
  executor: Executor,
  authorId: string,
  contextFileId: string,
): Promise<boolean> {
  const rows = await executor
    .delete(contextFiles)
    .where(and(eq(contextFiles.id, contextFileId), writtenBy(executor, authorId)))
    .returning({ id: contextFiles.id });
  return rows.length > 0;
}

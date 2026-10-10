import {
  PlanBody,
  type PageInput,
  type PlanningTurnKind,
  type PlanRevision,
  type PlanRevisionSource,
  PlanRevisionSummary,
} from '@plangineer/contracts';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import {
  planningTurnContextFiles,
  planningTurns,
  planRevisionContextFiles,
  planRevisionRepositories,
  planRevisions,
} from '../db/schema.ts';

/** One context file per task of a feature. */
const CONTEXT_FILES_MAX = 12;
/** A feature involves one repository until several are built. */
const REPOSITORIES_MAX = 1;

export interface StoredRevision {
  id: string;
  number: number;
  source: PlanRevisionSource;
  body: PlanBody;
  createdAt: Date;
}

const revisionColumns = {
  id: planRevisions.id,
  number: planRevisions.number,
  source: planRevisions.source,
  body: planRevisions.body,
  createdAt: planRevisions.createdAt,
};

const toStored = (row: Omit<StoredRevision, 'body'> & { body: unknown }): StoredRevision => ({
  ...row,
  body: PlanBody.parse(row.body),
});

/** The feature's newest revision. */
export async function findLatestRevision(
  executor: Executor,
  featureId: string,
): Promise<StoredRevision | undefined> {
  const [row] = await executor
    .select(revisionColumns)
    .from(planRevisions)
    .where(eq(planRevisions.featureId, featureId))
    .orderBy(desc(planRevisions.number))
    .limit(1);
  return row === undefined ? undefined : toStored(row);
}

/** The feature's revision with the given number. */
export async function findRevisionByNumber(
  executor: Executor,
  featureId: string,
  number: number,
): Promise<StoredRevision | undefined> {
  const [row] = await executor
    .select(revisionColumns)
    .from(planRevisions)
    .where(and(eq(planRevisions.featureId, featureId), eq(planRevisions.number, number)));
  return row === undefined ? undefined : toStored(row);
}

/** The context files and base commits a revision was built from. */
export async function findRevisionSources(
  executor: Executor,
  revisionId: string,
): Promise<Pick<PlanRevision, 'contextFiles' | 'baseCommits'>> {
  const contextFiles = await executor
    .select({ id: planRevisionContextFiles.contextFileId, title: planRevisionContextFiles.title })
    .from(planRevisionContextFiles)
    .where(eq(planRevisionContextFiles.revisionId, revisionId))
    .orderBy(asc(planRevisionContextFiles.id))
    .limit(CONTEXT_FILES_MAX);
  const baseCommits = await executor
    .select({
      repositoryId: planRevisionRepositories.repositoryId,
      commit: planRevisionRepositories.baseCommit,
    })
    .from(planRevisionRepositories)
    .where(eq(planRevisionRepositories.revisionId, revisionId))
    .orderBy(asc(planRevisionRepositories.id))
    .limit(REPOSITORIES_MAX);
  return { contextFiles, baseCommits };
}

/** One page of the feature's revisions, id descending, with one extra row to tell if more exist. */
export async function listRevisionSummaries(
  executor: Executor,
  featureId: string,
  { cursor, limit }: PageInput,
): Promise<PlanRevisionSummary[]> {
  const rows = await executor
    .select({
      id: planRevisions.id,
      number: planRevisions.number,
      source: planRevisions.source,
      createdAt: planRevisions.createdAt,
    })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.featureId, featureId),
        cursor === undefined ? undefined : lt(planRevisions.id, cursor),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(limit + 1);
  return rows.map((row) =>
    PlanRevisionSummary.parse({ ...row, createdAt: row.createdAt.toISOString() }),
  );
}

/** The feature's newest revisions, newest first, each with the kind of turn that wrote it. */
export async function listRecentRevisions(
  executor: Executor,
  featureId: string,
  limit: number,
): Promise<{ turnKind: PlanningTurnKind | null; body: PlanBody }[]> {
  const rows = await executor
    .select({ turnKind: planningTurns.kind, body: planRevisions.body })
    .from(planRevisions)
    .leftJoin(planningTurns, eq(planningTurns.id, planRevisions.turnId))
    .where(eq(planRevisions.featureId, featureId))
    .orderBy(desc(planRevisions.number))
    .limit(limit);
  return rows.map((row) => ({ turnKind: row.turnKind, body: PlanBody.parse(row.body) }));
}

export type RevisionAuthor =
  | { source: 'agent'; turnId: string }
  | { source: 'engineer'; authorId: string };

/** Inserts a revision row, without its context files or base commits. */
export async function insertRevision(
  tx: Transaction,
  revision: { featureId: string; number: number; body: PlanBody; author: RevisionAuthor },
): Promise<string> {
  const { author } = revision;
  const [row] = await tx
    .insert(planRevisions)
    .values({
      featureId: revision.featureId,
      number: revision.number,
      body: PlanBody.parse(revision.body),
      source: author.source,
      turnId: author.source === 'agent' ? author.turnId : null,
      authorId: author.source === 'engineer' ? author.authorId : null,
    })
    .returning({ id: planRevisions.id });
  if (row === undefined) throw new Error('Plan revision insert returned no row');
  return row.id;
}

/** The context files a turn read, with their titles when it was queued. */
export async function listTurnContextFiles(
  executor: Executor,
  turnId: string,
): Promise<PlanRevision['contextFiles']> {
  return executor
    .select({ id: planningTurnContextFiles.contextFileId, title: planningTurnContextFiles.title })
    .from(planningTurnContextFiles)
    .where(eq(planningTurnContextFiles.turnId, turnId))
    .orderBy(asc(planningTurnContextFiles.id))
    .limit(CONTEXT_FILES_MAX);
}

/** Records the context files and base commits a revision was built from. */
export async function insertRevisionSources(
  tx: Transaction,
  revisionId: string,
  { contextFiles, baseCommits }: Pick<PlanRevision, 'contextFiles' | 'baseCommits'>,
): Promise<void> {
  if (contextFiles.length > 0) {
    await tx
      .insert(planRevisionContextFiles)
      .values(
        contextFiles.map((file) => ({ revisionId, contextFileId: file.id, title: file.title })),
      );
  }
  if (baseCommits.length > 0) {
    await tx.insert(planRevisionRepositories).values(
      baseCommits.map((base) => ({
        revisionId,
        repositoryId: base.repositoryId,
        baseCommit: base.commit,
      })),
    );
  }
}

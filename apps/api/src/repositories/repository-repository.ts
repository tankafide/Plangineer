import {
  type PageInput,
  RepositoryDetail,
  RepositoryScan,
  RepositorySummary,
  RoleSettings,
  SetupSelection,
  WorkflowSettings,
} from '@plangineer/contracts';
import { desc, eq, inArray, lt } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { repositories, repositorySetups, runs } from '../db/schema.ts';

export interface NewRepository {
  githubRepositoryId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
  description: string;
  roleSettings: RoleSettings;
  workflowSettings: WorkflowSettings;
  createdBy: string;
}

/** Inserts a repository, or returns undefined when its GitHub id is already added. */
export async function insertRepository(
  tx: Transaction,
  repository: NewRepository,
): Promise<string | undefined> {
  const [row] = await tx
    .insert(repositories)
    .values({
      ...repository,
      roleSettings: RoleSettings.parse(repository.roleSettings),
      workflowSettings: WorkflowSettings.parse(repository.workflowSettings),
    })
    .onConflictDoNothing({ target: repositories.githubRepositoryId })
    .returning({ id: repositories.id });
  return row?.id;
}

/** The GitHub ids among these that are already added. */
export async function findAddedGithubIds(
  executor: Executor,
  githubRepositoryIds: number[],
): Promise<Set<number>> {
  if (githubRepositoryIds.length === 0) return new Set();
  const rows = await executor
    .select({ id: repositories.githubRepositoryId })
    .from(repositories)
    .where(inArray(repositories.githubRepositoryId, githubRepositoryIds));
  return new Set(rows.map((row) => row.id));
}

/** One page of repositories, id descending, with one extra row to tell if more exist. */
export async function listRepositorySummaries(
  executor: Executor,
  { cursor, limit }: PageInput,
): Promise<RepositorySummary[]> {
  const rows = await executor
    .select({
      id: repositories.id,
      owner: repositories.owner,
      name: repositories.name,
      description: repositories.description,
      setupStatus: repositorySetups.status,
    })
    .from(repositories)
    .leftJoin(repositorySetups, eq(repositorySetups.repositoryId, repositories.id))
    .where(cursor === undefined ? undefined : lt(repositories.id, cursor))
    .orderBy(desc(repositories.id))
    .limit(limit + 1);
  return rows.map((row) => RepositorySummary.parse(row));
}

/** A repository with its setup, as the viewer sees it. */
export async function findRepositoryDetail(
  executor: Executor,
  repositoryId: string,
  viewerId: string,
): Promise<RepositoryDetail | undefined> {
  const [row] = await executor
    .select({
      repository: repositories,
      setup: repositorySetups,
      run: { id: runs.id, status: runs.status, userId: runs.userId },
    })
    .from(repositories)
    .leftJoin(repositorySetups, eq(repositorySetups.repositoryId, repositories.id))
    .leftJoin(runs, eq(runs.id, repositorySetups.runId))
    .where(eq(repositories.id, repositoryId));
  if (row === undefined) return undefined;
  const { repository, setup, run } = row;
  return RepositoryDetail.parse({
    id: repository.id,
    githubRepositoryId: repository.githubRepositoryId,
    owner: repository.owner,
    name: repository.name,
    description: repository.description,
    roleSettings: RoleSettings.parse(repository.roleSettings),
    workflowSettings: WorkflowSettings.parse(repository.workflowSettings),
    createdAt: repository.createdAt.toISOString(),
    setup:
      setup === null
        ? null
        : {
            status: setup.status,
            scan: RepositoryScan.parse(setup.scan),
            selection: setup.selection === null ? null : SetupSelection.parse(setup.selection),
            run:
              run === null
                ? null
                : { id: run.id, status: run.status, startedByViewer: run.userId === viewerId },
            pullRequest:
              setup.pullRequestNumber === null || setup.pullRequestUrl === null
                ? null
                : { number: setup.pullRequestNumber, url: setup.pullRequestUrl },
            failureMessage: setup.failureMessage,
            updatedAt: setup.updatedAt.toISOString(),
          },
  });
}

export interface RepositoryRef {
  id: string;
  githubRepositoryId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
}

const REF_COLUMNS = {
  id: repositories.id,
  githubRepositoryId: repositories.githubRepositoryId,
  githubInstallationId: repositories.githubInstallationId,
  owner: repositories.owner,
  name: repositories.name,
};

/** The repository's GitHub ids and its last known owner and name, without a lock. */
export async function findRepositoryRef(
  executor: Executor,
  repositoryId: string,
): Promise<RepositoryRef | undefined> {
  const [row] = await executor
    .select(REF_COLUMNS)
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  return row;
}

/** Locks a repository row, which every change to its setup takes first or through the setup. */
export async function lockRepository(
  tx: Transaction,
  repositoryId: string,
): Promise<RepositoryRef | undefined> {
  const [row] = await tx
    .select(REF_COLUMNS)
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .for('update');
  return row;
}

export interface RepositoryChanges {
  description?: string | undefined;
  roleSettings?: RoleSettings | undefined;
  workflowSettings?: WorkflowSettings | undefined;
  owner?: string | undefined;
  name?: string | undefined;
}

/** Sets the given fields, and returns whether the repository exists. */
export async function updateRepository(
  executor: Executor,
  repositoryId: string,
  changes: RepositoryChanges,
): Promise<boolean> {
  const rows = await executor
    .update(repositories)
    .set({
      ...changes,
      ...(changes.roleSettings && { roleSettings: RoleSettings.parse(changes.roleSettings) }),
      ...(changes.workflowSettings && {
        workflowSettings: WorkflowSettings.parse(changes.workflowSettings),
      }),
    })
    .where(eq(repositories.id, repositoryId))
    .returning({ id: repositories.id });
  return rows.length > 0;
}

export async function deleteRepository(tx: Transaction, repositoryId: string): Promise<void> {
  await tx.delete(repositories).where(eq(repositories.id, repositoryId));
}

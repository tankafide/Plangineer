import {
  GitRef,
  INSTALLABLE_REPOSITORIES_MAX,
  type InstallableRepository,
  type PageInput,
  type RepositoryAddInput,
  type RepositoryDetail,
  type RepositoryListInstallableOutput,
  type RepositoryUpdateInput,
  type RoleSetting,
  type RoleSettings,
} from '@plangineer/contracts';
import type { GithubInstallableRepository } from '../github/github.ts';
import { githubFailed } from '../github/github-failed.ts';
import { toPage } from '../lib/page.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { findSetupStatus } from '../setup/setup-repository.ts';
import {
  deleteRepository,
  findAddedGithubIds,
  findRepositoryDetail,
  hasFeatures,
  insertRepository,
  listRepositorySummaries,
  lockRepository,
  updateRepository,
} from './repository-repository.ts';

const DEFAULT_ROLE: RoleSetting = {
  agent: 'claude_code',
  model: null,
  runsOn: 'local_runner',
  signIn: 'engineer_login',
};

const DEFAULT_ROLE_SETTINGS: RoleSettings = {
  pre_planning: DEFAULT_ROLE,
  planning: DEFAULT_ROLE,
  plan_review: DEFAULT_ROLE,
  implementation: DEFAULT_ROLE,
  implementation_review: DEFAULT_ROLE,
  verification: DEFAULT_ROLE,
};

const byOwnerThenName = (a: InstallableRepository, b: InstallableRepository) =>
  a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);

/** The repository the viewer just changed. It exists, since the caller found or made it. */
async function readDetail(
  deps: ServiceDeps,
  repositoryId: string,
  viewerId: string,
): Promise<RepositoryDetail> {
  const detail = await findRepositoryDetail(deps.db, repositoryId, viewerId);
  if (detail === undefined) throw new Error(`Repository ${repositoryId} vanished`);
  return detail;
}

/** The repositories the App reaches that are not added yet, with the App's install page. */
export async function listInstallableRepositories({
  db,
  github,
  appStore,
}: ServiceDeps): Promise<Result<RepositoryListInstallableOutput, 'GITHUB_FAILED'>> {
  let reachable: InstallableRepository[];
  try {
    reachable = await github.listInstallableRepositories();
  } catch (error) {
    return githubFailed(error);
  }
  const app = await appStore.get();
  if (app === null) throw new Error('GitHub App is not configured');
  const added = await findAddedGithubIds(
    db,
    reachable.map((repository) => repository.githubRepositoryId),
  );
  const items = reachable
    .filter((repository) => !added.has(repository.githubRepositoryId))
    .toSorted(byOwnerThenName);
  return ok({
    items: items.slice(0, INSTALLABLE_REPOSITORIES_MAX),
    truncated: items.length > INSTALLABLE_REPOSITORIES_MAX,
    installUrl: `https://github.com/apps/${app.slug}/installations/new`,
  });
}

/** Adds a repository the App reaches, Manual, with every role on today's only option. */
export async function addRepository(
  deps: ServiceDeps,
  userId: string,
  input: RepositoryAddInput,
): Promise<Result<RepositoryDetail, 'NOT_FOUND' | 'CONFLICT' | 'GITHUB_FAILED'>> {
  let reachable: GithubInstallableRepository[];
  try {
    reachable = await deps.github.listInstallableRepositories();
  } catch (error) {
    return githubFailed(error);
  }
  const found = reachable.find(
    (repository) => repository.githubRepositoryId === input.githubRepositoryId,
  );
  if (found === undefined) return fail('NOT_FOUND');
  // Every pre-planning run checks out this branch, so a name GitRef refuses fails here, loudly.
  const defaultBranch = GitRef.parse(found.defaultBranch);
  const repositoryId = await deps.db.transaction((tx) =>
    insertRepository(tx, {
      githubRepositoryId: found.githubRepositoryId,
      githubInstallationId: found.installationId,
      owner: found.owner,
      name: found.name,
      description: input.description,
      roleSettings: DEFAULT_ROLE_SETTINGS,
      defaultRunMode: 'manual',
      defaultBranch,
      createdBy: userId,
    }),
  );
  if (repositoryId === undefined) return fail('CONFLICT');
  return ok(await readDetail(deps, repositoryId, userId));
}

export async function listRepositories({ db }: ServiceDeps, page: PageInput) {
  return toPage(await listRepositorySummaries(db, page), page.limit);
}

export async function getRepository(
  { db }: ServiceDeps,
  userId: string,
  repositoryId: string,
): Promise<Result<RepositoryDetail, 'NOT_FOUND'>> {
  const detail = await findRepositoryDetail(db, repositoryId, userId);
  return detail === undefined ? fail('NOT_FOUND') : ok(detail);
}

/** Replaces only the fields the input gives. */
export async function changeRepository(
  deps: ServiceDeps,
  userId: string,
  { repositoryId, ...changes }: RepositoryUpdateInput,
): Promise<Result<RepositoryDetail, 'NOT_FOUND'>> {
  if (!(await updateRepository(deps.db, repositoryId, changes))) return fail('NOT_FOUND');
  return ok(await readDetail(deps, repositoryId, userId));
}

/** Deletes a repository and its setup, unless its setup is generating or a feature involves it. */
export async function removeRepository(
  { db }: ServiceDeps,
  repositoryId: string,
): Promise<Result<{ repositoryId: string }, 'NOT_FOUND' | 'CONFLICT'>> {
  return db.transaction(async (tx) => {
    if ((await lockRepository(tx, repositoryId)) === undefined) return fail('NOT_FOUND');
    if ((await findSetupStatus(tx, repositoryId)) === 'generating') return fail('CONFLICT');
    if (await hasFeatures(tx, repositoryId)) return fail('CONFLICT');
    await deleteRepository(tx, repositoryId);
    return ok({ repositoryId });
  });
}

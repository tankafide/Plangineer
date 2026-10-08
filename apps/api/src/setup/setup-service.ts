import type { z } from 'zod';
import {
  type InvalidSelectionData,
  type RepositoryDetail,
  type RepositoryScan,
  SetupJob,
  type SetupStartInput,
} from '@plangineer/contracts';
import { nextSetupStatus, validateSetupSelection } from '@plangineer/domain';
import type { GithubRepository } from '../github/github.ts';
import { err, fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import {
  findRepositoryDetail,
  findRepositoryRef,
  lockRepository,
  type RepositoryRef,
  updateRepository,
} from '../repositories/repository-repository.ts';
import { githubFailed } from '../repositories/repository-service.ts';
import { lockRunnerForUser, wakeRunner } from '../runners/runner-repository.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { insertRun } from '../runs/run-repository.ts';
import { buildScan, planScan, scanBlobShas } from './repository-scan.ts';
import { advanceSetup } from './setup-advance.ts';
import { renderSetupFiles, renderSetupInputs, renderSetupPrompt } from './setup-files.ts';
import {
  findSetupStatus,
  type LockedSetup,
  lockSetup,
  markStarted,
  saveScan,
} from './setup-repository.ts';

async function readSetupDetail(
  { db }: ServiceDeps,
  repositoryId: string,
  viewerId: string,
): Promise<RepositoryDetail> {
  const detail = await findRepositoryDetail(db, repositoryId, viewerId);
  if (detail === undefined) throw new Error(`Repository ${repositoryId} vanished`);
  return detail;
}

/** The repository as GitHub sees it now, and its scan, or undefined when it is too large. */
async function scanFromGithub(
  { github }: ServiceDeps,
  ref: RepositoryRef,
): Promise<{ repository: GithubRepository; scan: RepositoryScan } | undefined> {
  const info = await github.getRepository(ref.githubInstallationId, ref.githubRepositoryId);
  const repository: GithubRepository = {
    installationId: ref.githubInstallationId,
    repositoryId: info.repositoryId,
    owner: info.owner,
    name: info.name,
  };
  const plan = planScan(await github.readTree(repository, info.defaultBranch));
  if (plan === undefined) return undefined;
  const blobs = await github.readBlobs(repository, scanBlobShas(plan));
  const scan = buildScan(plan, blobs, {
    defaultBranch: info.defaultBranch,
    scannedAt: new Date().toISOString(),
  });
  return { repository, scan };
}

/**
 * Scans the repository's default branch and stores the scan as a new setup. GitHub is read
 * before the transaction, which then locks the repository row, so a first scan is ordered too.
 */
export async function scanRepository(
  deps: ServiceDeps,
  userId: string,
  repositoryId: string,
): Promise<
  Result<RepositoryDetail, 'NOT_FOUND' | 'CONFLICT' | 'GITHUB_FAILED' | 'REPOSITORY_TOO_LARGE'>
> {
  const ref = await findRepositoryRef(deps.db, repositoryId);
  if (ref === undefined) return fail('NOT_FOUND');
  if ((await findSetupStatus(deps.db, repositoryId)) === 'generating') return fail('CONFLICT');
  let scanned: Awaited<ReturnType<typeof scanFromGithub>>;
  try {
    scanned = await scanFromGithub(deps, ref);
  } catch (error) {
    return githubFailed(error);
  }
  if (scanned === undefined) return fail('REPOSITORY_TOO_LARGE');
  const { repository, scan } = scanned;
  const stored = await deps.db.transaction(async (tx) => {
    if ((await lockRepository(tx, repositoryId)) === undefined) return fail('NOT_FOUND');
    const next = nextSetupStatus(await findSetupStatus(tx, repositoryId), 'scanned');
    if (!next.ok) return fail('CONFLICT');
    await updateRepository(tx, repositoryId, { owner: repository.owner, name: repository.name });
    await saveScan(tx, repositoryId, scan, next.status);
    return ok(undefined);
  });
  if (!stored.ok) return stored;
  return ok(await readSetupDetail(deps, repositoryId, userId));
}

const invalidSelection = (data: InvalidSelectionData) => err('INVALID_SELECTION', data);

/**
 * Whether a job failed only on a size bound: a string, an array or the whole job's byte cap,
 * which is the job's one refinement at its root. Any other failure is a rendering bug.
 */
function overBoundsOnly(error: z.ZodError): boolean {
  return error.issues.every(
    (issue) => issue.code === 'too_big' || (issue.code === 'custom' && issue.path.length === 0),
  );
}

/**
 * The setup job for a selection, rendered and checked, or undefined when it is over a bound.
 * A job that breaks any other rule throws, since setup rendered it wrong.
 */
function buildSetupJob(
  setup: LockedSetup,
  ref: RepositoryRef,
  selection: SetupStartInput['selection'],
): SetupJob | undefined {
  const rendered = renderSetupFiles(setup.scan, selection);
  const job = SetupJob.safeParse({
    kind: 'setup',
    repository: { owner: ref.owner, name: ref.name },
    commit: setup.scan.commit,
    defaultBranch: setup.scan.defaultBranch,
    prompt: renderSetupPrompt(),
    inputs: renderSetupInputs(setup.scan, selection),
    files: rendered.files,
    moveSkills: setup.scan.skills
      .filter((skill) => skill.location === 'claude')
      .map((skill) => skill.name),
    templateSkills: rendered.templateSkills,
    generateSkills: rendered.generateSkills,
  });
  if (job.success) return job.data;
  if (overBoundsOnly(job.error)) return undefined;
  throw job.error;
}

/**
 * Renders and checks the whole setup job, then queues it as a setup run on the admin's runner,
 * in one transaction holding the runner's, the repository's and the setup's locks, so no run
 * exists for a job that could not be built and no scan or remove slips in between.
 */
export async function startSetup(
  deps: ServiceDeps,
  userId: string,
  { repositoryId, runnerId, selection }: SetupStartInput,
): Promise<Result<RepositoryDetail, 'NOT_FOUND' | 'CONFLICT' | 'INVALID_SELECTION'>> {
  const { db, env, logger } = deps;
  const started = await db.transaction(async (tx) => {
    const runner = await lockRunnerForUser(tx, userId, runnerId);
    if (runner === undefined || runner.status === 'revoked') return fail('NOT_FOUND');
    // Scan and remove lock the repository row before they read the setup, so start does too.
    const ref = await lockRepository(tx, repositoryId);
    const setup = ref === undefined ? undefined : await lockSetup(tx, repositoryId);
    if (setup === undefined || ref === undefined) return fail('NOT_FOUND');
    if (!nextSetupStatus(setup.status, 'started').ok) return fail('CONFLICT');
    const check = validateSetupSelection(setup.scan, selection);
    if (!check.ok) return invalidSelection({ reason: check.reason, names: check.names });
    const job = buildSetupJob(setup, ref, selection);
    if (job === undefined) return invalidSelection({ reason: 'too_large', names: [] });
    const runId = await insertRun(tx, userId, {
      kind: 'setup',
      runnerId,
      repository: job.repository,
      ref: job.commit,
      prompt: job.prompt,
    });
    await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], {
      leaseDurationMs: env.RUN_LEASE_DURATION_MS,
      logger,
    });
    await markStarted(tx, setup.id, { selection, job, runId });
    await wakeRunner(tx, runnerId);
    return ok(undefined);
  });
  if (!started.ok) return started;
  return ok(await readSetupDetail(deps, repositoryId, userId));
}

/** Follows the setup's run or pull request now, as when a run ends. */
export async function refreshSetup(
  deps: ServiceDeps,
  userId: string,
  repositoryId: string,
): Promise<Result<RepositoryDetail, 'NOT_FOUND' | 'GITHUB_FAILED'>> {
  if ((await findRepositoryRef(deps.db, repositoryId)) === undefined) return fail('NOT_FOUND');
  const advanced = await advanceSetup(deps, repositoryId, 'refresh');
  if (!advanced.ok) return advanced;
  return ok(await readSetupDetail(deps, repositoryId, userId));
}

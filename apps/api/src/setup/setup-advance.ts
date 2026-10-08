import { SETUP_BRANCH } from '@plangineer/contracts';
import { nextSetupStatus, type SetupEvent } from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import { GithubError, type GithubRepository } from '../github/github.ts';
import { err, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { findRepositoryRef } from '../repositories/repository-repository.ts';
import { renderSetupPullRequestBody, SETUP_PULL_REQUEST_TITLE } from './setup-pull-request.ts';
import {
  findRepositoryIdForRun,
  findSetupRunOutcome,
  type LockedSetup,
  lockSetup,
  markComplete,
  markFailed,
  markPullRequestOpen,
  type SetupRunOutcome,
} from './setup-repository.ts';

const githubMessage = (error: GithubError) => `GitHub answered ${error.status}: ${error.message}`;

/** Checks the move against the setup status rules, which a caller's status check already passed. */
function expectMove(setup: LockedSetup, event: SetupEvent): void {
  if (!nextSetupStatus(setup.status, event).ok) {
    throw new Error(`Setup ${setup.id} cannot take ${event} from ${setup.status}`);
  }
}

/** Opens the setup pull request, or updates the body of the one already open for the branch. */
async function openPullRequest(
  deps: ServiceDeps,
  repository: GithubRepository,
  setup: LockedSetup,
  outcome: SetupRunOutcome & { pushed: NonNullable<SetupRunOutcome['pushed']> },
) {
  if (setup.selection === null || setup.job === null) {
    throw new Error(`Generating setup ${setup.id} has no selection or job`);
  }
  const body = renderSetupPullRequestBody({
    scan: setup.scan,
    selection: setup.selection,
    job: setup.job,
    changedPaths: outcome.pushed.changedPaths,
    changedPathCount: outcome.pushed.changedPathCount,
    finalMessage: outcome.resultText ?? '',
  });
  const open = await deps.github.findOpenPullRequest(repository, SETUP_BRANCH);
  if (open !== null) return deps.github.updatePullRequestBody(repository, open.number, body);
  return deps.github.createPullRequest(repository, {
    title: SETUP_PULL_REQUEST_TITLE,
    body,
    head: SETUP_BRANCH,
    base: setup.scan.defaultBranch,
  });
}

/** Moves a generating setup from what its run reported. A GitHub failure is the caller's to handle. */
async function advanceGenerating(
  deps: ServiceDeps,
  tx: Transaction,
  repository: GithubRepository,
  setup: LockedSetup,
): Promise<void> {
  const outcome = setup.runId === null ? undefined : await findSetupRunOutcome(tx, setup.runId);
  if (outcome === undefined) {
    expectMove(setup, 'generation_failed');
    await markFailed(tx, setup.id, 'The setup run no longer exists.');
    return;
  }
  if (outcome.status === 'cancelled' || outcome.status === 'failed') {
    expectMove(setup, 'generation_failed');
    const message =
      outcome.status === 'cancelled'
        ? 'The setup run was cancelled.'
        : (outcome.failureMessage ?? 'The setup run failed.');
    await markFailed(tx, setup.id, message);
    return;
  }
  if (outcome.status !== 'succeeded') return;
  const { pushed } = outcome;
  if (pushed === undefined) {
    expectMove(setup, 'generation_failed');
    await markFailed(tx, setup.id, 'The runner reported no pushed branch.');
    return;
  }
  const pullRequest = await openPullRequest(deps, repository, setup, { ...outcome, pushed });
  expectMove(setup, 'pr_opened');
  await markPullRequestOpen(tx, setup.id, pullRequest);
}

/** Moves an open pull request's setup when the pull request merged or closed. */
async function advancePullRequestOpen(
  deps: ServiceDeps,
  tx: Transaction,
  repository: GithubRepository,
  setup: LockedSetup,
): Promise<void> {
  if (setup.pullRequestNumber === null) {
    throw new Error(`Setup ${setup.id} is pr_open with no pull request`);
  }
  const pullRequest = await deps.github.getPullRequest(repository, setup.pullRequestNumber);
  if (pullRequest.merged) {
    expectMove(setup, 'pr_merged');
    await markComplete(tx, setup.id);
  } else if (pullRequest.state === 'closed') {
    expectMove(setup, 'pr_closed');
    await markFailed(tx, setup.id, 'The setup pull request was closed without merging.');
  }
}

/**
 * Who asks for the advance. When a run ends, nobody is waiting, so a GitHub failure while opening
 * the pull request fails the setup with GitHub's message. On refresh the admin is waiting, so the
 * failure returns GITHUB_FAILED and the setup stays as it was, to try again.
 */
export type AdvanceTrigger = 'run_ended' | 'refresh';

/**
 * Moves a setup from what its run and pull request show, under the setup row's lock for the
 * whole call, GitHub requests included, so a second call waits and finds the status moved.
 */
export async function advanceSetup(
  deps: ServiceDeps,
  repositoryId: string,
  trigger: AdvanceTrigger,
): Promise<Result<void, 'GITHUB_FAILED'>> {
  return deps.db.transaction(async (tx) => {
    const setup = await lockSetup(tx, repositoryId);
    // A read, not a lock: scan locks the repository before the setup, so this order never waits on it.
    const ref = await findRepositoryRef(tx, repositoryId);
    if (setup === undefined || ref === undefined) return ok(undefined);
    const repository: GithubRepository = {
      installationId: ref.githubInstallationId,
      repositoryId: ref.githubRepositoryId,
      owner: ref.owner,
      name: ref.name,
    };
    try {
      if (setup.status === 'generating') await advanceGenerating(deps, tx, repository, setup);
      else if (setup.status === 'pr_open')
        await advancePullRequestOpen(deps, tx, repository, setup);
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      if (setup.status === 'generating' && trigger === 'run_ended') {
        expectMove(setup, 'generation_failed');
        await markFailed(tx, setup.id, githubMessage(error));
        return ok(undefined);
      }
      return err('GITHUB_FAILED', { status: error.status, message: error.message });
    }
    return ok(undefined);
  });
}

/**
 * Advances the setup a run serves, after the run ended. It never throws, since its callers
 * are a runner socket, the sweeper and cancels, which must carry on: a failure is logged, and
 * refresh retries it.
 */
export async function advanceSetupOfRun(deps: ServiceDeps, runId: string): Promise<void> {
  try {
    const repositoryId = await findRepositoryIdForRun(deps.db, runId);
    if (repositoryId !== undefined) await advanceSetup(deps, repositoryId, 'run_ended');
  } catch (error) {
    deps.logger.error({ err: error, runId }, 'Setup could not advance after its run ended');
  }
}

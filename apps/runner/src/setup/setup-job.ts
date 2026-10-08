import path from 'node:path';
import {
  FAILURE_MESSAGE_MAX,
  type RunnerRunEventBody,
  SETUP_BRANCH,
  type SetupJob,
  SKILLS_ROOT,
} from '@plangineer/contracts';
import { lintSkill } from '../skills/skill-lint.ts';
import { GitError } from '../worktrees/git.ts';
import { finishRepositoryFiles, guardChangedPaths, publishSetup } from './setup-publish.ts';
import {
  checkAgentWork,
  lintedSkills,
  moveSkills,
  refuseLinkedPaths,
  SetupOutputError,
  type SkillSnapshot,
  snapshotSkills,
  writeSetupFiles,
} from './setup-tree.ts';

type RunFailed = Extract<RunnerRunEventBody, { type: 'run.failed' }>;
type SetupPushed = Extract<RunnerRunEventBody, { type: 'setup.pushed' }>;

export type SetupStep<T> = { ok: true; value: T } | { ok: false; event: RunFailed };

function failed(
  reason: RunFailed['reason'],
  message: string,
  stderrTail: string[] = [],
): { ok: false; event: RunFailed } {
  return {
    ok: false,
    event: {
      type: 'run.failed',
      reason,
      message: message.slice(0, FAILURE_MESSAGE_MAX),
      exitCode: null,
      stderrTail,
    },
  };
}

/** Runs a step, turning broken output into setup_invalid_output. Any other error is the runner's. */
async function step<T>(work: () => Promise<T>): Promise<SetupStep<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof SetupOutputError) return failed('setup_invalid_output', error.message);
    throw error;
  }
}

/**
 * Before the agent: moves the claude-only skills, writes the rendered files and the inputs, and
 * records what the agent must keep.
 */
export function prepareSetup(worktree: string, job: SetupJob): Promise<SetupStep<SkillSnapshot>> {
  return step(async () => {
    await refuseLinkedPaths(worktree);
    await moveSkills(worktree, job.moveSkills);
    await writeSetupFiles(worktree, job);
    return snapshotSkills(worktree, job);
  });
}

async function lintProblems(worktree: string, job: SetupJob): Promise<string[]> {
  const skillsRoot = path.join(worktree, SKILLS_ROOT);
  const problems: string[] = [];
  for (const name of lintedSkills(job)) {
    for (const problem of await lintSkill(skillsRoot, name, skillsRoot)) {
      problems.push(`${name}: ${problem}`);
    }
  }
  return problems;
}

/**
 * After the agent: checks its work and the skill rules, finishes the mirror and repository
 * files, guards the changed paths, then commits and force-pushes plangineer/setup.
 */
export async function finishSetup(
  worktree: string,
  job: SetupJob,
  snapshot: SkillSnapshot,
  runnerVersion: string,
): Promise<SetupStep<SetupPushed>> {
  const checked = await step(async () => {
    const problems = [
      ...(await checkAgentWork(worktree, job, snapshot)),
      ...(await lintProblems(worktree, job)),
    ];
    if (problems.length > 0) throw new SetupOutputError(problems.join('\n'));
    await refuseLinkedPaths(worktree);
    await finishRepositoryFiles(worktree, { defaultBranch: job.defaultBranch, runnerVersion });
    await guardChangedPaths(worktree);
  });
  if (!checked.ok) return checked;
  try {
    const pushed = await publishSetup(worktree, job.commit);
    return { ok: true, value: { type: 'setup.pushed', branch: SETUP_BRANCH, ...pushed } };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return failed('setup_publish_failed', error.message, error.stderrTail);
  }
}

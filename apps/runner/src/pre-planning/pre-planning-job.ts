import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AGENT_TEXT_MAX,
  type PrePlanningJob,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import { ServerFileError, type ServerFiles } from '../connection/server-files.ts';
import { type RunFailed, runFailed } from '../jobs/run-failed.ts';
import { refuseTaskFolder, TASK_DIR } from '../jobs/task-folder.ts';
import { checkoutEntry } from '../setup/setup-tree.ts';

const ATTACHMENTS_DIR = `${TASK_DIR}/attachments`;
const EXPLORATION_SKILL = '.agents/skills/codebase-exploration/SKILL.md';
const SAFE_NAME_MAX = 60;

type RunSucceeded = Extract<RunnerRunEventBody, { type: 'run.succeeded' }>;

/**
 * An attachment's file name with only `[A-Za-z0-9._-]`, its last 60 characters kept. A trailing
 * dot becomes `-` too, because Windows drops it from a file name and the listed path would differ.
 */
function safeAttachmentName(name: string): string {
  return name
    .replaceAll(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.$/, '-')
    .slice(-SAFE_NAME_MAX);
}

function inputsFile(job: PrePlanningJob, commit: string, saved: string[]): string {
  const attachments = saved.length === 0 ? 'None' : saved.map((rel) => `- ${rel}`).join('\n');
  return [
    job.inputs.trimEnd(),
    '## Base commit',
    commit,
    '## Branch',
    job.ref,
    '## Attachments',
    attachments,
  ].join('\n\n');
}

/** Saves each attachment as `<n>-<safe name>` and returns their `/`-separated paths. */
async function downloadAttachments(
  worktree: string,
  job: PrePlanningJob,
  serverFiles: ServerFiles,
  signal: AbortSignal,
): Promise<string[] | RunFailed> {
  const saved: string[] = [];
  for (const [index, attachment] of job.attachments.entries()) {
    const rel = `${ATTACHMENTS_DIR}/${index + 1}-${safeAttachmentName(attachment.name)}`;
    try {
      await serverFiles.attachment(attachment.id, path.join(worktree, ...rel.split('/')), signal);
    } catch (error) {
      if (!(error instanceof ServerFileError)) throw error;
      return runFailed(
        'attachment_failed',
        `The attachment ${attachment.name} could not be downloaded: ${error.message}.`,
      );
    }
    saved.push(rel);
  }
  return saved;
}

/**
 * Readies the worktree for a pre-planning task: refuses a checkout that holds the task folder,
 * checks an exploration task's skill, downloads the attachments and writes the inputs file.
 * Returns the failure that ends the run, or null when the agent may start.
 */
export async function preparePrePlanning(
  worktree: string,
  commit: string,
  job: PrePlanningJob,
  serverFiles: ServerFiles,
  signal: AbortSignal,
): Promise<RunFailed | null> {
  const taken = await refuseTaskFolder(worktree);
  if (taken !== null) return taken;
  if (job.task === 'exploration' && !(await checkoutEntry(worktree, EXPLORATION_SKILL))?.isFile()) {
    return runFailed(
      'skill_missing',
      `The repository has no ${EXPLORATION_SKILL}, which an exploration task follows.`,
    );
  }
  await mkdir(path.join(worktree, ...ATTACHMENTS_DIR.split('/')), { recursive: true });
  const saved = await downloadAttachments(worktree, job, serverFiles, signal);
  if (!Array.isArray(saved)) return saved;
  await writeFile(
    path.join(worktree, TASK_DIR, 'inputs.md'),
    `${inputsFile(job, commit, saved)}\n`,
  );
  return null;
}

/**
 * The run's end once the agent succeeded: its answer is the context file, so an empty or cut
 * answer fails the run instead.
 */
export function finishPrePlanning(succeeded: RunSucceeded): RunSucceeded | RunFailed {
  if (succeeded.resultText.trim() !== '' && !succeeded.truncated) return succeeded;
  return runFailed(
    'invalid_output',
    `The agent's answer was empty or longer than ${AGENT_TEXT_MAX.toLocaleString('en-US')} characters.`,
  );
}

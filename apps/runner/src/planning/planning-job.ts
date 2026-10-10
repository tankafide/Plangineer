import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PLANNING_OUTPUT_MAX_BYTES,
  PlanningOutput,
  type PlanningJob,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import { outputFits } from '@plangineer/domain';
import type { z } from 'zod';
import { ServerFileError } from '../connection/server-files.ts';
import { type RunFailed, runFailed } from '../jobs/run-failed.ts';
import { refuseTaskFolder, TASK_DIR } from '../jobs/task-folder.ts';
import { checkoutEntry } from '../setup/setup-tree.ts';

const PLAN_SKILL = '.agents/skills/plan-orchestrator/SKILL.md';
const OUTPUT_FILE = `${TASK_DIR}/output.json`;

type PlanningOutputEvent = Extract<RunnerRunEventBody, { type: 'planning.output' }>;

/** Saves the run's planning inputs to `destination`, throwing `ServerFileError` on a failure. */
export type DownloadInputs = (destination: string, signal: AbortSignal) => Promise<void>;

/**
 * Readies the worktree for a planning turn: refuses a checkout that holds the task folder, checks
 * the plan-orchestrator skill, downloads the inputs and writes the settings block the agent's
 * system prompt carries. Returns the settings file, or the failure that ends the run.
 */
export async function preparePlanning(
  worktree: string,
  job: PlanningJob,
  inputs: DownloadInputs,
  signal: AbortSignal,
): Promise<{ ok: true; systemPromptFile: string } | { ok: false; event: RunFailed }> {
  const taken = await refuseTaskFolder(worktree);
  if (taken !== null) return { ok: false, event: taken };
  if (!(await checkoutEntry(worktree, PLAN_SKILL))?.isFile()) {
    const message = `The repository has no ${PLAN_SKILL}, which a planning turn follows.`;
    return { ok: false, event: runFailed('skill_missing', message) };
  }
  const taskDir = path.join(worktree, TASK_DIR);
  await mkdir(taskDir);
  try {
    await inputs(path.join(taskDir, 'inputs.md'), signal);
  } catch (error) {
    if (!(error instanceof ServerFileError)) throw error;
    const message = `The planning inputs could not be downloaded: ${error.message}.`;
    return { ok: false, event: runFailed('inputs_failed', message) };
  }
  // The block review-loop.md defines: the label on one line and the settings as JSON on the next.
  const systemPromptFile = path.join(taskDir, 'settings.md');
  await writeFile(systemPromptFile, `Workflow settings:\n${JSON.stringify(job.settings)}\n`);
  return { ok: true, systemPromptFile };
}

function invalidOutput(problem: string): RunFailed {
  return runFailed('invalid_output', `The agent's ${OUTPUT_FILE} ${problem}.`);
}

function firstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return error.message;
  const at = issue.path.length === 0 ? 'the output' : issue.path.join('.');
  return `${at}: ${issue.message}`;
}

/** Reads the output file, refusing a missing file, a link, a folder and a file past the cap. */
async function readOutputFile(worktree: string): Promise<string | RunFailed> {
  const entry = await checkoutEntry(worktree, OUTPUT_FILE);
  if (entry === null) return invalidOutput('is missing');
  if (!entry.isFile()) return invalidOutput('is not a regular file');
  if (entry.size > PLANNING_OUTPUT_MAX_BYTES) {
    return invalidOutput(`is larger than ${PLANNING_OUTPUT_MAX_BYTES} bytes`);
  }
  return readFile(path.join(worktree, ...OUTPUT_FILE.split('/')), 'utf8');
}

/**
 * The run's planning output once the agent succeeded, checked as JSON, against the output schema
 * and against the turn, or the failure that ends the run in place of its success.
 */
export async function finishPlanning(
  worktree: string,
  job: PlanningJob,
): Promise<PlanningOutputEvent | RunFailed> {
  const text = await readOutputFile(worktree);
  if (typeof text !== 'string') return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return invalidOutput(`is not JSON: ${error.message}`);
  }
  const parsed = PlanningOutput.safeParse(value);
  if (!parsed.success) {
    return invalidOutput(`does not match the output schema at ${firstIssue(parsed.error)}`);
  }
  const output = parsed.data;
  if (!outputFits({ kind: job.turn, section: job.section }, output, job.settings.decisions)) {
    const section = job.section === null ? '' : ` on ${job.section}`;
    return invalidOutput(
      `holds a ${output.kind} output, which a ${job.turn} turn${section} under the ${job.settings.decisions} decisions setting cannot take`,
    );
  }
  return { type: 'planning.output', output };
}

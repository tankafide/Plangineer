import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import { z } from 'zod';
import { ImplementationReport, PlanReport, runSession, sessionIdOf } from './auto-run-session.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const DEFAULT_ROUNDS = 2;
const LOG_DIR = 'logs/auto';

/** The run's outcome, written beside the session logs when the run ends. */
export const OUTCOME_FILE = 'outcome.json';
/** The run's result, or the error that ended it. */
export const Outcome = z.union([
  z.strictObject({ error: z.string() }),
  z.looseObject({ ready: z.boolean(), reasons: z.array(z.string()) }),
]);

/** Facts about the run that a watcher needs, written when its log folder is created. */
export const RUN_FILE = 'run.json';
export const RunFile = z.strictObject({ baseCommit: z.string().min(1) });

const autoReview = (count) => ({ findings: 'fix_all', rounds: { mode: 'fixed', count } });

/** The settings block for both sessions: no pauses, every kept finding fixed, fixed rounds. */
function settingsBlock({ planRounds, implementationRounds }) {
  const settings = {
    planCheckIn: 'skip',
    planReview: autoReview(planRounds),
    implementationReview: autoReview(implementationRounds),
    decisions: 'recommended',
  };
  return `Workflow settings:\n${JSON.stringify(settings)}\n`;
}

const FINISH = [
  "Start every subagent in the foreground, with the Agent tool's run_in_background set to false, and start parallel subagents in one message. Never end a turn to wait for background work: the output schema makes the first turn that ends return the report.",
  "Start a long-running process, such as a dev server, only with the Bash tool's run_in_background, never with &, nohup, setsid or Start-Process, and stop it before you finish.",
  'Finish once the last review round is committed, then return the report the output schema describes.',
];

function planPrompt(request) {
  return [
    'Use the plan-orchestrator skill to plan the engineer request below.',
    'The request is the goal of the whole run. This session only plans it: it never changes code, tests, config or scripts, and a separate session builds the plan after this one ends.',
    '',
    '<request>',
    request.trim(),
    '</request>',
    '',
    ...FINISH,
  ].join('\n');
}

function implementationPrompt(planPath) {
  return [
    `Use the implementation-orchestrator skill to build the plan at ${planPath} on the current branch.`,
    'The branch may already hold part of this build from an earlier session. Keep that work, build only the steps it lacks, and treat it as your own.',
    'Each implementation review round reviews the whole branch: its base commit is `git merge-base HEAD origin/HEAD`, never a commit this session made.',
    'Do not push.',
    ...FINISH,
  ].join('\n');
}

function resumePrompt() {
  return [
    'You were cut off before your workflow finished. Continue it from where you stopped, starting from the state of the working tree and of every subagent you started.',
    'Do not push.',
    ...FINISH,
  ].join('\n');
}

/** Why a session's work cannot go on to the next phase. Empty when it can. */
function blockers(report) {
  return [
    ...(report.outcome === 'stopped' ? [`Stopped: ${report.stopReason}`] : []),
    ...report.engineerActions.map((action) => `Engineer action: ${action}`),
  ];
}

async function git(cwd, ...args) {
  return (await execa('git', args, { cwd })).stdout.trim();
}

/**
 * Checks that cwd is a linked worktree on a branch, and clean unless a session is resumed, and
 * returns the main checkout, which keeps the logs after the worktree is removed.
 */
async function mainCheckoutOf(cwd, { clean }) {
  const dirs = await git(
    cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
  );
  const [gitDir, commonDir] = dirs.split(/\r?\n/);
  if (gitDir === commonDir) throw new Error('Run auto-run from a linked worktree');
  const branch = await execa('git', ['symbolic-ref', '--quiet', 'HEAD'], { cwd, reject: false });
  if (branch.exitCode !== 0) throw new Error('The worktree has a detached HEAD');
  if (clean && (await git(cwd, 'status', '--porcelain')) !== '') {
    throw new Error('The working tree has uncommitted changes');
  }
  return path.dirname(commonDir);
}

/** The phase a resumed session log belongs to, from its file name. */
function phaseOf(resumeLog) {
  const phase = path.basename(resumeLog, '.jsonl');
  if (phase !== 'plan' && phase !== 'implementation') {
    throw new Error(`${resumeLog} is not a plan.jsonl or implementation.jsonl session log`);
  }
  return phase;
}

/**
 * Creates a new run's log folder with its settings and base commit, or reuses the resumed run's
 * folder.
 */
async function prepareLogDir({ cwd, resumeLog, planRounds, implementationRounds }) {
  const mainCheckout = await mainCheckoutOf(cwd, { clean: resumeLog === undefined });
  if (resumeLog !== undefined) {
    const logDir = path.dirname(resumeLog);
    await rm(path.join(logDir, OUTCOME_FILE), { force: true });
    return logDir;
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const logDir = path.join(mainCheckout, LOG_DIR, stamp);
  await mkdir(logDir, { recursive: true });
  await writeFile(
    path.join(logDir, 'settings.md'),
    settingsBlock({ planRounds, implementationRounds }),
  );
  const run = RunFile.parse({ baseCommit: await git(cwd, 'rev-parse', 'HEAD') });
  await writeFile(path.join(logDir, RUN_FILE), JSON.stringify(run));
  return logDir;
}

/** Writes the outcome whole, so a watcher never reads half of it. */
async function writeOutcome(logDir, outcome) {
  const file = path.join(logDir, OUTCOME_FILE);
  await writeFile(`${file}.tmp`, JSON.stringify(outcome, null, 2));
  await rename(`${file}.tmp`, file);
}

async function runPhases({ session, request, planPath, resume }) {
  const start = (phase, prompt, schema) =>
    resume?.phase === phase
      ? session(phase, resumePrompt(), schema, resume.sessionId)
      : session(phase, prompt(), schema);

  let plan = null;
  let builtPlan = planPath;
  if (request !== undefined || resume?.phase === 'plan') {
    plan = await start('plan', () => planPrompt(request), PlanReport);
    const reasons = blockers(plan);
    if (reasons.length > 0) return { ready: false, reasons, plan, implementation: null };
    builtPlan = plan.planPath;
  }
  const implementation = await start(
    'implementation',
    () => implementationPrompt(builtPlan),
    ImplementationReport,
  );
  const reasons = [
    ...blockers(implementation),
    ...implementation.checks.failed.map((check) => `Failed check: ${check}`),
  ];
  return { ready: reasons.length === 0, reasons, plan, implementation };
}

/**
 * Plans the request, or starts from planPath, then builds the plan. Stops after planning when
 * the plan leaves anything for the engineer. With resumeLog, it continues that cut-off session,
 * then runs the phase after it. The outcome, or the error, also goes to OUTCOME_FILE.
 */
export async function autoRun({
  command,
  cwd,
  request,
  planPath,
  resumeLog,
  planRounds,
  implementationRounds,
}) {
  const resume =
    resumeLog === undefined
      ? undefined
      : { phase: phaseOf(resumeLog), sessionId: await sessionIdOf(resumeLog) };
  const logDir = await prepareLogDir({ cwd, resumeLog, planRounds, implementationRounds });
  if (request !== undefined) await writeFile(path.join(logDir, 'request.md'), request);
  const settingsFile = path.join(logDir, 'settings.md');
  const session = (name, prompt, schema, resumeId) => {
    const logFile = path.join(logDir, `${name}.jsonl`);
    console.error(`Running the ${name} session. Its log is ${logFile}`);
    return runSession({ command, cwd, prompt, settingsFile, schema, logFile, resumeId });
  };
  try {
    const outcome = await runPhases({ session, request, planPath, resume });
    await writeOutcome(logDir, outcome);
    return outcome;
  } catch (error) {
    await writeOutcome(logDir, { error: error.message });
    throw error;
  }
}

const RoundCount = z.coerce.number().int().min(1);

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'request-file': { type: 'string' },
      plan: { type: 'string' },
      resume: { type: 'string' },
      'plan-rounds': { type: 'string' },
      'implementation-rounds': { type: 'string' },
    },
  });
  const starts = [values['request-file'], values.plan, values.resume];
  if (starts.filter((start) => start !== undefined).length !== 1) {
    throw new Error('Pass exactly one of --request-file, --plan and --resume');
  }
  const rounds = [values['plan-rounds'], values['implementation-rounds']];
  if (values.resume !== undefined && rounds.some((count) => count !== undefined)) {
    throw new Error('A resumed run keeps its settings, so it takes no round counts');
  }
  return {
    requestFile: values['request-file'],
    planPath: values.plan,
    resumeLog: values.resume === undefined ? undefined : path.resolve(values.resume),
    planRounds: RoundCount.parse(values['plan-rounds'] ?? DEFAULT_ROUNDS),
    implementationRounds: RoundCount.parse(values['implementation-rounds'] ?? DEFAULT_ROUNDS),
  };
}

async function main() {
  const { requestFile, ...options } = parseCli(process.argv.slice(2));
  const request = requestFile === undefined ? undefined : await readFile(requestFile, 'utf8');
  const outcome = await autoRun({ command: ['claude'], cwd: repoRoot, request, ...options });
  console.log(JSON.stringify(outcome, null, 2));
}

if (isEntryPoint(import.meta.url)) {
  await main().catch(reportFailure);
}

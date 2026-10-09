import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import { z } from 'zod';
import { ImplementationReport, PlanReport, runSession } from './auto-run-session.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const DEFAULT_ROUNDS = 2;
const LOG_DIR = 'logs/auto';

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

function planPrompt(request) {
  return [
    'Use the plan-orchestrator skill to plan the engineer request below.',
    '',
    '<request>',
    request.trim(),
    '</request>',
    '',
    'Finish once the last review round is committed, then return the report the output schema describes.',
  ].join('\n');
}

function implementationPrompt(planPath) {
  return [
    `Use the implementation-orchestrator skill to build the plan at ${planPath} on the current branch.`,
    'Do not push.',
    'Finish once the last review round is committed, then return the report the output schema describes.',
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
 * Checks that cwd is a clean linked worktree on a branch, and returns the main checkout, which
 * keeps the logs after the worktree is removed.
 */
async function mainCheckoutOf(cwd) {
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
  if ((await git(cwd, 'status', '--porcelain')) !== '') {
    throw new Error('The working tree has uncommitted changes');
  }
  return path.dirname(commonDir);
}

/**
 * Plans the request, or starts from planPath, then builds the plan. Stops after planning when
 * the plan leaves anything for the engineer.
 */
export async function autoRun({
  command,
  cwd,
  request,
  planPath,
  planRounds,
  implementationRounds,
}) {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const logDir = path.join(await mainCheckoutOf(cwd), LOG_DIR, stamp);
  await mkdir(logDir, { recursive: true });
  const settingsFile = path.join(logDir, 'settings.md');
  await writeFile(settingsFile, settingsBlock({ planRounds, implementationRounds }));
  const session = (name, prompt, schema) => {
    const logFile = path.join(logDir, `${name}.jsonl`);
    console.error(`Running the ${name} session. Its log is ${logFile}`);
    return runSession({ command, cwd, prompt, settingsFile, schema, logFile });
  };

  let plan = null;
  let builtPlan = planPath;
  if (request !== undefined) {
    await writeFile(path.join(logDir, 'request.md'), request);
    plan = await session('plan', planPrompt(request), PlanReport);
    const reasons = blockers(plan);
    if (reasons.length > 0) return { ready: false, reasons, plan, implementation: null };
    builtPlan = plan.planPath;
  }
  const implementation = await session(
    'implementation',
    implementationPrompt(builtPlan),
    ImplementationReport,
  );
  const reasons = [
    ...blockers(implementation),
    ...implementation.checks.failed.map((check) => `Failed check: ${check}`),
  ];
  return { ready: reasons.length === 0, reasons, plan, implementation };
}

const RoundCount = z.coerce.number().int().min(1);

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'request-file': { type: 'string' },
      plan: { type: 'string' },
      'plan-rounds': { type: 'string', default: String(DEFAULT_ROUNDS) },
      'implementation-rounds': { type: 'string', default: String(DEFAULT_ROUNDS) },
    },
  });
  if ((values['request-file'] === undefined) === (values.plan === undefined)) {
    throw new Error('Pass exactly one of --request-file and --plan');
  }
  return {
    requestFile: values['request-file'],
    planPath: values.plan,
    planRounds: RoundCount.parse(values['plan-rounds']),
    implementationRounds: RoundCount.parse(values['implementation-rounds']),
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

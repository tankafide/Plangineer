/** An auto run's log folder: its settings, run file, findings files and outcome. */
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { z } from 'zod';
import { git } from './auto-run-checks.mjs';

const LOG_DIR = 'logs/auto';
const SETTINGS_FILE = 'settings.md';
/** The only folder a fix session may read outside its worktree, so it holds findings files only. */
const FINDINGS_DIR = 'findings';

/** The run's outcome, written beside the session logs when the run ends. */
export const OUTCOME_FILE = 'outcome.json';
/** The run's result, or the error that ended it. */
export const Outcome = z.union([
  z.strictObject({ error: z.string() }),
  z.looseObject({ ready: z.boolean(), reasons: z.array(z.string()) }),
]);

/**
 * Facts about the run that a watcher and a resumed run need: the commit it started from, the plan
 * it builds, the commit each step started from, which the checks after a resumed step trust, and
 * each authoring and fix step's report, which a resumed run's gate reads.
 */
export const RUN_FILE = 'run.json';
export const RunFile = z.strictObject({
  baseCommit: z.string().min(1),
  planPath: z.string().min(1).nullable(),
  stepHeads: z.record(z.string(), z.string().min(1)),
  stepReports: z.record(z.string(), z.unknown()),
});

export const RoundCount = z.coerce.number().int().min(1);

const AutoReview = z.strictObject({
  findings: z.literal('fix_all'),
  rounds: z.strictObject({ mode: z.literal('fixed'), count: RoundCount }),
});

const Settings = z.strictObject({
  planCheckIn: z.literal('skip'),
  planReview: AutoReview,
  implementationReview: AutoReview,
  decisions: z.literal('recommended'),
});

const SETTINGS_HEADING = 'Workflow settings:';

const autoReview = (count) => ({ findings: 'fix_all', rounds: { mode: 'fixed', count } });

/** The settings block for every session: no pauses, every valid finding fixed, fixed rounds. */
function settingsBlock({ planRounds, implementationRounds }) {
  const settings = Settings.parse({
    planCheckIn: 'skip',
    planReview: autoReview(planRounds),
    implementationReview: autoReview(implementationRounds),
    decisions: 'recommended',
  });
  return `${SETTINGS_HEADING}\n${JSON.stringify(settings)}\n`;
}

export const settingsFileOf = (logDir) => path.join(logDir, SETTINGS_FILE);

/** Each phase's round count, read from the run's settings block, its one source. */
export async function roundsOf(logDir) {
  const settingsFile = settingsFileOf(logDir);
  const [heading, block] = (await readFile(settingsFile, 'utf8')).split(/\r?\n/);
  if (heading !== SETTINGS_HEADING) throw new Error(`${settingsFile} holds no settings block`);
  const settings = Settings.parse(JSON.parse(block));
  return {
    plan: settings.planReview.rounds.count,
    implementation: settings.implementationReview.rounds.count,
  };
}

export const reviewStep = (phase, round) => `${phase}-review-${round}`;
export const fixStep = (phase, round) => `${phase}-fix-${round}`;

/** Where a review round's findings file is, in the run's findings folder. */
export const findingsFileOf = (logDir, phase, round) =>
  path.join(logDir, FINDINGS_DIR, `${reviewStep(phase, round)}.findings.json`);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Writes a file whole, so a watcher or a resumed run never reads half of it. */
export async function writeWhole(file, text) {
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

export async function readRunFile(logDir) {
  return RunFile.parse(JSON.parse(await readFile(path.join(logDir, RUN_FILE), 'utf8')));
}

export async function saveRunFile(logDir, runFile) {
  await writeWhole(path.join(logDir, RUN_FILE), JSON.stringify(RunFile.parse(runFile)));
}

/** Saves an authoring or fix step's report, so a run resumed after it still gates on it. */
export async function saveReport(logDir, runFile, step, report) {
  runFile.stepReports[step] = report;
  await saveRunFile(logDir, runFile);
}

/** The commit a step started from, recorded when it first started. */
export function recordedHead(runFile, step) {
  const head = runFile.stepHeads[step];
  if (head === undefined) throw new Error(`${RUN_FILE} holds no starting commit for ${step}`);
  return head;
}

/** A step's saved report, parsed with its schema. */
export function savedReport(runFile, step, schema) {
  const saved = runFile.stepReports[step];
  if (saved === undefined) throw new Error(`${RUN_FILE} holds no report for ${step}`);
  return schema.parse(saved);
}

export async function writeOutcome(logDir, outcome) {
  await writeWhole(path.join(logDir, OUTCOME_FILE), JSON.stringify(outcome, null, 2));
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

/**
 * The step a session log was on when it was cut off. An author log continues the fix of the
 * highest round with a findings file, or else its authoring step.
 */
export async function resumePointOf(resumeLog) {
  const name = path.basename(resumeLog);
  const review = /^(plan|implementation)-review-([1-9]\d*)\.jsonl$/.exec(name);
  if (review !== null) {
    const [, phase, round] = review;
    return { phase, step: reviewStep(phase, round), round: Number(round), fix: false };
  }
  const author = /^(plan|implementation)\.jsonl$/.exec(name);
  if (author === null) throw new Error(`${resumeLog} is not a session log of an auto run`);
  const [, phase] = author;
  const logDir = path.dirname(resumeLog);
  let round = 0;
  while (await exists(findingsFileOf(logDir, phase, round + 1))) round += 1;
  return round === 0
    ? { phase, step: phase, round: 1, fix: false }
    : { phase, step: fixStep(phase, round), round, fix: true };
}

/**
 * Creates a new run's log folder with its settings, run file and findings folder, or reuses the
 * resumed run's folder, and returns it.
 */
export async function prepareLogDir({
  cwd,
  resumeLog,
  planPath,
  planRounds,
  implementationRounds,
}) {
  const mainCheckout = await mainCheckoutOf(cwd, { clean: resumeLog === undefined });
  if (resumeLog !== undefined) {
    const logDir = path.dirname(resumeLog);
    await rm(path.join(logDir, OUTCOME_FILE), { force: true });
    return logDir;
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const logDir = path.join(mainCheckout, LOG_DIR, stamp);
  await mkdir(path.join(logDir, FINDINGS_DIR), { recursive: true });
  await writeFile(settingsFileOf(logDir), settingsBlock({ planRounds, implementationRounds }));
  await saveRunFile(logDir, {
    baseCommit: await git(cwd, 'rev-parse', 'HEAD'),
    planPath: planPath ?? null,
    stepHeads: {},
    stepReports: {},
  });
  return logDir;
}

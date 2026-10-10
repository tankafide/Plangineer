import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import { assertClean, assertDocsOnly, assertNoCommits, reviewBase } from './auto-run-checks.mjs';
import {
  fixPrompt,
  implementationPrompt,
  implementationReviewPrompt,
  planPrompt,
  planReviewPrompt,
  resumePrompt,
} from './auto-run-prompts.mjs';
import {
  FindingsFile,
  ImplementationFixReport,
  ImplementationReport,
  PlanFixReport,
  PlanReport,
  ReviewReport,
  runSession,
  sessionIdOf,
} from './auto-run-session.mjs';
import {
  findingsFileOf,
  fixStep,
  prepareLogDir,
  readRunFile,
  resumePointOf,
  reviewStep,
  RoundCount,
  roundsOf,
  RUN_FILE,
  saveRunFile,
  settingsFileOf,
  writeOutcome,
  writeWhole,
} from './auto-run-log.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const DEFAULT_ROUNDS = 2;

const PHASES = {
  plan: { report: PlanReport, fixReport: PlanFixReport },
  implementation: { report: ImplementationReport, fixReport: ImplementationFixReport },
};

/** The commit a step started from: recorded now for a new step, or when a resumed step began. */
async function startingCommit(run, step, resumed) {
  if (resumed) {
    const head = run.runFile.stepHeads[step];
    if (head === undefined) throw new Error(`${RUN_FILE} holds no starting commit for ${step}`);
    return head;
  }
  const { stdout: head } = await execa('git', ['rev-parse', 'HEAD'], { cwd: run.cwd });
  run.runFile.stepHeads[step] = head;
  await saveRunFile(run.logDir, run.runFile);
  return head;
}

/**
 * Runs one step's session, the cut-off one continued when the run resumes at this step, and
 * checks it left a clean tree. A step that resumes its author, or that resumes a cut-off session,
 * continues the session its log holds.
 */
async function runStep(run, step, { log, prompt, schema, resumesAuthor = false, addDir }) {
  const resumed = run.resume?.step === step;
  if (resumed) run.resume = undefined;
  const head = await startingCommit(run, step, resumed);
  const logFile = path.join(run.logDir, log);
  const resumeId = resumed || resumesAuthor ? await sessionIdOf(logFile) : undefined;
  console.error(`Running the ${step} session. Its log is ${logFile}`);
  const report = await runSession({
    command: run.command,
    cwd: run.cwd,
    prompt: resumed ? resumePrompt() : await prompt(head),
    settingsFile: settingsFileOf(run.logDir),
    schema,
    logFile,
    resumeId,
    addDir,
  });
  run.sessions.push({ step, report });
  await assertClean(run.cwd, step);
  return { report, head };
}

async function authorStep(run, phase, prompt) {
  const { report, head } = await runStep(run, phase, {
    log: `${phase}.jsonl`,
    prompt,
    schema: PHASES[phase].report,
  });
  if (phase === 'plan') {
    await assertDocsOnly(run.cwd, head, phase);
    run.runFile.planPath = report.planPath;
    await saveRunFile(run.logDir, run.runFile);
  }
  return report;
}

/** Runs a review round and returns its report, with its findings file when it found anything. */
async function reviewRound(run, phase, round) {
  const step = reviewStep(phase, round);
  const { planPath } = run.runFile;
  if (planPath === null) throw new Error(`${RUN_FILE} holds no plan for ${step} to review`);
  const baseCommit = phase === 'implementation' ? await reviewBase(run.cwd) : null;
  const { report, head } = await runStep(run, step, {
    log: `${step}.jsonl`,
    prompt: async (headCommit) =>
      baseCommit === null
        ? planReviewPrompt(planPath)
        : implementationReviewPrompt({ planPath, baseCommit, headCommit }),
    schema: ReviewReport,
  });
  await assertNoCommits(run.cwd, head, step);
  if (report.outcome === 'stopped' || report.findings.length === 0) return { report };
  const findingsFile = findingsFileOf(run.logDir, phase, round);
  const contents = FindingsFile.parse({
    review: phase,
    planPath,
    baseCommit,
    headCommit: head,
    planAudit: report.planAudit,
    findings: report.findings,
  });
  await writeWhole(findingsFile, JSON.stringify(contents, null, 2));
  return { report, findingsFile };
}

/** Resumes the author session with a round's findings file and checks it judged every finding. */
async function fixRound(run, phase, round, findingsFile) {
  const step = fixStep(phase, round);
  const { report, head } = await runStep(run, step, {
    log: `${phase}.jsonl`,
    prompt: async () => fixPrompt({ phase, round, findingsFile }),
    schema: PHASES[phase].fixReport,
    resumesAuthor: true,
    addDir: path.dirname(findingsFile),
  });
  if (phase === 'plan') await assertDocsOnly(run.cwd, head, step);
  const { findings } = FindingsFile.parse(JSON.parse(await readFile(findingsFile, 'utf8')));
  const judged = report.valid + report.invalid;
  if (report.outcome === 'done' && judged !== findings.length) {
    throw new Error(
      `The ${step} session judged ${judged} findings, the file holds ${findings.length}`,
    );
  }
  return report;
}

const engineerActions = (reports) =>
  reports.flatMap((report) => report.engineerActions.map((action) => `Engineer action: ${action}`));

/**
 * Runs a phase: its authoring session, then review and fix rounds until the phase's count, a
 * review with no findings or a fix with nothing valid. A resumed run starts at its resume point.
 * Returns why the run cannot go on, empty when it can.
 */
async function runPhase(run, phase, authorPrompt) {
  const resume = run.resume?.phase === phase ? run.resume : undefined;
  const reports = [];
  const stop = (report) => [`Stopped: ${report.stopReason}`, ...engineerActions(reports)];
  if (resume === undefined || resume.step === phase) {
    const report = await authorStep(run, phase, authorPrompt);
    reports.push(report);
    if (report.outcome === 'stopped') return stop(report);
  }
  for (let round = resume?.round ?? 1; round <= run.rounds[phase]; round += 1) {
    let findingsFile = findingsFileOf(run.logDir, phase, round);
    if (!(resume?.fix && resume.round === round)) {
      const review = await reviewRound(run, phase, round);
      if (review.report.outcome === 'stopped') return stop(review.report);
      if (review.findingsFile === undefined) break;
      ({ findingsFile } = review);
    }
    const fix = await fixRound(run, phase, round, findingsFile);
    reports.push(fix);
    if (fix.outcome === 'stopped') return stop(fix);
    if (fix.valid === 0) break;
  }
  const failedChecks = (reports.at(-1)?.checks?.failed ?? []).map(
    (check) => `Failed check: ${check}`,
  );
  return [...engineerActions(reports), ...failedChecks];
}

async function runPhases(run, { request, planFirst }) {
  const finish = (reasons) => ({ ready: reasons.length === 0, reasons, sessions: run.sessions });
  if (planFirst) {
    const reasons = await runPhase(run, 'plan', async () => planPrompt(request));
    if (reasons.length > 0) return finish(reasons);
  }
  return finish(
    await runPhase(run, 'implementation', async () => implementationPrompt(run.runFile.planPath)),
  );
}

/**
 * Plans the request and reviews the plan, or starts from planPath, then builds the plan and
 * reviews the build. Each review round runs in a new session and resumes the author session to
 * judge and fix its findings. Stops after the plan phase when the plan leaves anything for the
 * engineer. With resumeLog, it continues that cut-off session, then the steps after it. The
 * outcome, or the error, also goes to OUTCOME_FILE.
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
  const resume = resumeLog === undefined ? undefined : await resumePointOf(resumeLog);
  const logDir = await prepareLogDir({
    cwd,
    resumeLog,
    planPath,
    planRounds,
    implementationRounds,
  });
  if (request !== undefined) await writeFile(path.join(logDir, 'request.md'), request);
  const run = {
    command,
    cwd,
    logDir,
    resume,
    runFile: await readRunFile(logDir),
    rounds: await roundsOf(logDir),
    sessions: [],
  };
  try {
    const outcome = await runPhases(run, {
      request,
      planFirst: request !== undefined || resume?.phase === 'plan',
    });
    await writeOutcome(logDir, outcome);
    return outcome;
  } catch (error) {
    await writeOutcome(logDir, { error: error.message });
    throw error;
  }
}

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

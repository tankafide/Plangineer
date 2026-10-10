import { readFile, truncate } from 'node:fs/promises';
import { execa } from 'execa';
import { z } from 'zod';
import { trackSessionProcesses } from './session-processes.mjs';

/** Only the engineer's own session lands work, so the headless sessions cannot push or merge. */
const DISALLOWED_TOOLS = ['Bash(git push:*)', 'Bash(gh:*)'];

/**
 * `claude -p` stops waiting for background subagents after 600 s and makes the session report
 * early. A phase can run for over an hour, so the session waits for every subagent to finish.
 */
const SESSION_ENV = { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' };

const lines = (description) => z.array(z.string()).describe(description);

const reportFields = {
  branch: z.string().min(1).describe('The work branch'),
  commits: lines('Each commit this session made, as its short hash and summary line'),
  decisions: lines(
    'Each choice taken as the recommended option instead of asking the engineer, with its reason',
  ),
  engineerActions: lines(
    'Each thing the engineer must do before the work ships, such as an open prerequisite',
  ),
};

const done = { outcome: z.literal('done').describe('The skill finished its whole workflow') };

const stopped = {
  outcome: z.literal('stopped').describe('The skill could not finish its workflow'),
  stopReason: z.string().min(1).describe('Why the session stopped'),
};

export const PlanReport = z.discriminatedUnion('outcome', [
  z.strictObject({ ...done, ...reportFields, planPath: z.string().min(1) }),
  z.strictObject({
    ...stopped,
    ...reportFields,
    planPath: z.string().min(1).nullable().describe('The saved plan, or null when none was saved'),
  }),
]);

const implementationFields = {
  ...reportFields,
  checks: z.strictObject({
    passed: lines('Each check that ran and passed'),
    failed: lines('Each check that ran and failed'),
    notRun: lines('Each check that did not run, with the reason'),
  }),
  deviations: lines('Each departure from the plan, with its reason and keep or revert'),
};

export const ImplementationReport = z.discriminatedUnion('outcome', [
  z.strictObject({ ...done, ...implementationFields }),
  z.strictObject({ ...stopped, ...implementationFields }),
]);

const nonEmpty = z.string().min(1);

export const Finding = z.strictObject({
  location: nonEmpty.describe('A line range in the plan, or a file and lines in the diff'),
  claim: nonEmpty.describe('What is wrong, in one or two sentences'),
  suggestedChange: nonEmpty.describe('What the reviewer would do instead'),
  sourceSkill: nonEmpty.describe('The rule skill the reviewer applied, or none'),
  kind: z.enum(['defect', 'deviation', 'extra']).describe('The kind, as finding-format.md defines'),
  severity: z
    .enum(['blocker', 'should fix', 'nit'])
    .describe('The severity, as finding-format.md defines'),
});

const findings = z.array(Finding).describe('Every candidate finding the review collected');
const planAudit = z
  .string()
  .nullable()
  .describe('The plan audit from plan-conformance as Markdown, or null when the review had none');

export const ReviewReport = z.discriminatedUnion('outcome', [
  z.strictObject({ ...done, findings, planAudit }),
  z.strictObject(stopped),
]);

/** The file a review's findings reach the author session in. */
export const FindingsFile = z.strictObject({
  review: z.enum(['plan', 'implementation']),
  planPath: z.string().nullable(),
  baseCommit: z.string().nullable(),
  headCommit: z.string(),
  planAudit: z.string().nullable(),
  findings: z.array(Finding),
});

const count = (description) => z.number().int().nonnegative().describe(description);

const fixFields = {
  valid: count('How many findings the author judged valid'),
  invalid: count('How many findings the author judged invalid'),
  fixed: count('How many valid findings this round fixed or reverted'),
  decisions: reportFields.decisions,
  engineerActions: reportFields.engineerActions,
};

export const PlanFixReport = z.discriminatedUnion('outcome', [
  z.strictObject({ ...done, ...fixFields }),
  z.strictObject({ ...stopped, ...fixFields }),
]);

const implementationFixFields = { ...fixFields, checks: implementationFields.checks };

export const ImplementationFixReport = z.discriminatedUnion('outcome', [
  z.strictObject({ ...done, ...implementationFixFields }),
  z.strictObject({ ...stopped, ...implementationFixFields }),
]);

/** The fields Claude Code's stream-json result event carries that this script reads. */
export const ResultEvent = z.looseObject({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});

const StreamEvent = z.looseObject({ type: z.string() });

export const InitEvent = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().min(1),
});

/**
 * The output schema wraps the report in an object, because a tool's input schema cannot be a
 * union at its top level.
 */
export const reportOutput = (schema) => z.strictObject({ report: schema });

function parseEvent(line, logFile) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throw new Error(`The session wrote a line that is not JSON. See ${logFile}`, { cause: error });
  }
  const parsed = StreamEvent.safeParse(event);
  if (!parsed.success) {
    throw new Error(`The session wrote an event with no type. See ${logFile}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function events(log, logFile) {
  return log
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => parseEvent(line, logFile));
}

/** A log's bytes up to its last full line, leaving out a line a killed session cut short. */
async function completeLog(logFile) {
  const log = await readFile(logFile);
  return log.subarray(0, log.lastIndexOf(0x0a) + 1);
}

/** The id of the session a log holds, which `claude --resume` takes. */
export async function sessionIdOf(logFile) {
  const log = (await completeLog(logFile)).toString('utf8');
  const init = events(log, logFile).findLast(
    (event) => event.type === 'system' && event.subtype === 'init',
  );
  const parsed = InitEvent.safeParse(init);
  if (!parsed.success) throw new Error(`${logFile} holds no session to resume`);
  return parsed.data.session_id;
}

/**
 * Cuts a resumed session's log back to its last full line, so the resumed run's events start on
 * a line of their own, and returns where they start.
 */
async function endAtFullLine(logFile) {
  const { length } = await completeLog(logFile);
  await truncate(logFile, length);
  return length;
}

/** What the session wrote after offset bytes, so a resumed log ignores the earlier run. */
async function logSince(logFile, offset) {
  return (await readFile(logFile)).subarray(offset).toString('utf8');
}

/**
 * Runs one headless session, logs its stream to logFile, and returns its validated report. Auto
 * mode lets its classifier approve each action, and anything that would prompt is denied. With
 * resumeId, it continues that session and appends to its log. With addDir, the session can also
 * read and edit that folder. Once the session ends, every process it left running is stopped.
 */
export async function runSession({
  command,
  cwd,
  prompt,
  settingsFile,
  schema,
  logFile,
  resumeId,
  addDir,
  processPollMs,
}) {
  const [file, ...prefix] = command;
  const output = reportOutput(schema);
  const offset = resumeId === undefined ? 0 : await endAtFullLine(logFile);
  const args = [
    ...prefix,
    '-p',
    ...(resumeId === undefined ? [] : ['--resume', resumeId]),
    ...(addDir === undefined ? [] : ['--add-dir', addDir]),
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'auto',
    '--permission-prompts',
    'none',
    '--disallowedTools',
    ...DISALLOWED_TOOLS,
    '--append-system-prompt-file',
    settingsFile,
    '--json-schema',
    JSON.stringify(z.toJSONSchema(output, { target: 'draft-7' })),
  ];
  const session = execa(file, args, {
    cwd,
    env: SESSION_ENV,
    input: prompt,
    stdout: { file: logFile, append: resumeId !== undefined },
    stderr: 'inherit',
    reject: false,
  });
  const processes = trackSessionProcesses(session.pid, { pollMs: processPollMs });
  const run = await session;
  const cleanup = await processes.stop();
  if (cleanup.stopped.length > 0) {
    console.error(`Stopped processes the session left running: ${cleanup.stopped.join(', ')}`);
  }
  for (const failure of cleanup.failures) console.error(failure);
  const last = events(await logSince(logFile, offset), logFile).findLast(
    (event) => event.type === 'result',
  );
  if (last === undefined) {
    const ending = run.failed ? run.shortMessage : `exit code ${run.exitCode}`;
    throw new Error(`The session ended with no result (${ending}). See ${logFile}`, {
      cause: run,
    });
  }
  const result = ResultEvent.safeParse(last);
  if (!result.success) {
    throw new Error(`The session's result event has an unexpected shape. See ${logFile}`, {
      cause: result.error,
    });
  }
  const { subtype, is_error: isError, result: message, structured_output } = result.data;
  if (isError || subtype !== 'success') {
    const detail = [subtype, message].filter(Boolean).join(': ');
    throw new Error(`The session failed with ${detail}. See ${logFile}`);
  }
  const report = output.safeParse(structured_output);
  if (!report.success) {
    throw new Error(`The session's report does not match its schema. See ${logFile}`, {
      cause: report.error,
    });
  }
  return report.data.report;
}

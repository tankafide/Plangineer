import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { z } from 'zod';

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
  reviewRounds: lines(
    'One line per review round: its number and how many findings were fixed, skipped and dropped',
  ),
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

/** The fields Claude Code's stream-json result event carries that this script reads. */
const ResultEvent = z.looseObject({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});

const StreamEvent = z.looseObject({ type: z.string() });

/**
 * The output schema wraps the report in an object, because a tool's input schema cannot be a
 * union at its top level.
 */
const reportOutput = (schema) => z.strictObject({ report: schema });

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

function lastResult(log, logFile) {
  return log
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => parseEvent(line, logFile))
    .findLast((event) => event.type === 'result');
}

/**
 * Runs one headless session, logs its stream to logFile, and returns its validated report. Auto
 * mode lets its classifier approve each action, and anything that would prompt is denied.
 */
export async function runSession({ command, cwd, prompt, settingsFile, schema, logFile }) {
  const [file, ...prefix] = command;
  const output = reportOutput(schema);
  const args = [
    ...prefix,
    '-p',
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
  const run = await execa(file, args, {
    cwd,
    env: SESSION_ENV,
    input: prompt,
    stdout: { file: logFile },
    stderr: 'inherit',
    reject: false,
  });
  const last = lastResult(await readFile(logFile, 'utf8'), logFile);
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

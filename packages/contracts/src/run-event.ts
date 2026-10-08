import { z } from 'zod';
import { SETUP_BRANCH } from './repository-setup.ts';
import { CommitSha, RunCancelReason, RunFailureReason } from './run.ts';

/** The cap on every string an agent produces. The adapter truncates longer text. */
export const AGENT_TEXT_MAX = 65_536;
/** The cap on an agent-produced identifier or name, such as a tool use id or model. */
export const AGENT_NAME_MAX = 200;
export const SKILL_NAME_MAX = 100;
export const SKILLS_MAX = 500;
export const FAILURE_MESSAGE_MAX = 2_000;
export const STDERR_TAIL_LINES = 20;
export const STDERR_LINE_MAX = 500;

export const RunEventType = z.enum([
  'run.queued',
  'run.leased',
  'run.started',
  'agent.session',
  'agent.message',
  'agent.tool_use',
  'agent.tool_result',
  'agent.rate_limit',
  'agent.other',
  'run.cancel_requested',
  'run.lease_lost',
  'setup.pushed',
  'run.succeeded',
  'run.failed',
  'run.cancelled',
]);
export type RunEventType = z.infer<typeof RunEventType>;

const Attempt = z.int().min(1);
const AgentText = z.string().max(AGENT_TEXT_MAX);
const AgentName = z.string().min(1).max(AGENT_NAME_MAX);

const Envelope = { id: z.int().min(1), runId: z.uuid(), at: z.iso.datetime() };

/** One event type's body, and its stored form with the event id, run id and time. */
function eventType<T extends RunEventType, S extends z.ZodRawShape>(type: T, shape: S) {
  const body = z.strictObject({ type: z.literal(type), ...shape });
  return { body, event: body.extend(Envelope) };
}

const RunQueued = eventType('run.queued', {});
const RunLeased = eventType('run.leased', { runnerId: z.uuid(), attempt: Attempt });
const RunStarted = eventType('run.started', {
  commit: CommitSha,
  cli: z.strictObject({ name: z.literal('claude-code'), version: z.string().min(1).max(50) }),
});
const AgentSession = eventType('agent.session', {
  model: AgentName,
  cliVersion: z.string().min(1).max(50),
  skills: z.array(z.string().min(1).max(SKILL_NAME_MAX)).max(SKILLS_MAX),
});
const AgentMessage = eventType('agent.message', {
  text: AgentText,
  truncated: z.boolean(),
  parentToolUseId: AgentName.nullable(),
});
const AgentToolUse = eventType('agent.tool_use', {
  toolUseId: AgentName,
  name: AgentName,
  inputJson: AgentText,
  truncated: z.boolean(),
  parentToolUseId: AgentName.nullable(),
});
const AgentToolResult = eventType('agent.tool_result', {
  toolUseId: AgentName,
  isError: z.boolean(),
  text: AgentText,
  truncated: z.boolean(),
});
export const RateLimitStatus = z.enum(['allowed', 'allowed_warning', 'rejected']);
const AgentRateLimit = eventType('agent.rate_limit', {
  status: RateLimitStatus,
  resetsAt: z.iso.datetime().nullable(),
});
const AgentOther = eventType('agent.other', {
  vendorType: z.string().min(1).max(100),
  json: AgentText,
  truncated: z.boolean(),
});
const RunCancelRequested = eventType('run.cancel_requested', {});
const RunLeaseLost = eventType('run.lease_lost', { attempt: Attempt, requeued: z.boolean() });
/** The caps on the changed paths one setup.pushed event lists. The count covers the rest. */
export const SETUP_PUSHED_PATHS_MAX = 1_000;
export const SETUP_PUSHED_PATHS_MAX_BYTES = 320 * 1024;
const SetupPushed = eventType('setup.pushed', {
  branch: z.literal(SETUP_BRANCH),
  commit: CommitSha,
  changedPaths: z
    .array(z.string().min(1).max(300))
    .max(SETUP_PUSHED_PATHS_MAX)
    .refine(
      (paths) =>
        new TextEncoder().encode(JSON.stringify(paths)).byteLength <= SETUP_PUSHED_PATHS_MAX_BYTES,
      `must serialize to at most ${SETUP_PUSHED_PATHS_MAX_BYTES} bytes`,
    ),
  changedPathCount: z.int().min(0),
});
const RunSucceeded = eventType('run.succeeded', {
  resultText: AgentText,
  truncated: z.boolean(),
  costUsd: z.number().min(0).nullable(),
  durationMs: z.int().min(0),
  numTurns: z.int().min(0),
});
const RunFailed = eventType('run.failed', {
  reason: RunFailureReason,
  message: z.string().min(1).max(FAILURE_MESSAGE_MAX),
  exitCode: z.int().nullable(),
  stderrTail: z.array(z.string().max(STDERR_LINE_MAX)).max(STDERR_TAIL_LINES),
});
const RunCancelled = eventType('run.cancelled', { reason: RunCancelReason });

export const RunEventBody = z.discriminatedUnion('type', [
  RunQueued.body,
  RunLeased.body,
  RunStarted.body,
  AgentSession.body,
  AgentMessage.body,
  AgentToolUse.body,
  AgentToolResult.body,
  AgentRateLimit.body,
  AgentOther.body,
  RunCancelRequested.body,
  RunLeaseLost.body,
  SetupPushed.body,
  RunSucceeded.body,
  RunFailed.body,
  RunCancelled.body,
]);
export type RunEventBody = z.infer<typeof RunEventBody>;

/** The event types a runner may send. The rest are appended only by the API. */
export const RunnerRunEventBody = z.discriminatedUnion('type', [
  RunStarted.body,
  AgentSession.body,
  AgentMessage.body,
  AgentToolUse.body,
  AgentToolResult.body,
  AgentRateLimit.body,
  AgentOther.body,
  SetupPushed.body,
  RunSucceeded.body,
  RunFailed.body,
  RunCancelled.body,
]);
export type RunnerRunEventBody = z.infer<typeof RunnerRunEventBody>;

export const RunEvent = z.discriminatedUnion('type', [
  RunQueued.event,
  RunLeased.event,
  RunStarted.event,
  AgentSession.event,
  AgentMessage.event,
  AgentToolUse.event,
  AgentToolResult.event,
  AgentRateLimit.event,
  AgentOther.event,
  RunCancelRequested.event,
  RunLeaseLost.event,
  SetupPushed.event,
  RunSucceeded.event,
  RunFailed.event,
  RunCancelled.event,
]);
export type RunEvent = z.infer<typeof RunEvent>;

export const TERMINAL_RUN_EVENT_TYPES = [
  'run.succeeded',
  'run.failed',
  'run.cancelled',
] as const satisfies readonly RunEventType[];

export function isTerminalRunEvent(event: { type: RunEventType }): boolean {
  return (TERMINAL_RUN_EVENT_TYPES as readonly RunEventType[]).includes(event.type);
}

export const RUN_EVENTS_PATH = '/api/runs/:runId/events';

export function runEventsPath(runId: string): string {
  return RUN_EVENTS_PATH.replace(':runId', encodeURIComponent(runId));
}

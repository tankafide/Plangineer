import { z } from 'zod';
import {
  SETUP_INPUTS_MAX,
  SETUP_JOB_MAX_BYTES,
  SkillFilePath,
  SkillName,
} from './repository-setup.ts';
import { CommitSha, GitRef, Repository, RUN_PROMPT_MAX } from './run.ts';
import { jsonByteLength } from './json-bytes.ts';
import { RunnerRunEventBody } from './run-event.ts';
import { CliStatus, RunnerPlatform } from './runner.ts';

/** The largest text frame either side accepts. */
export const MAX_SOCKET_MESSAGE_BYTES = 1024 * 1024;
/** The runner caps each run.events message at this many bytes of serialized JSON. */
export const MAX_EVENTS_MESSAGE_BYTES = 512 * 1024;
export const MAX_EVENTS_PER_MESSAGE = 100;
export const MAX_ACTIVE_RUNS = 16;

/** Close codes on the runner socket beyond the standard ones. */
export const RunnerSocketClose = {
  normal: 1000,
  goingAway: 1001,
  policyViolation: 1008,
  messageTooBig: 1009,
  revoked: 4001,
  replaced: 4002,
} as const;

const Attempt = z.int().min(1);
const RunAttempt = { runId: z.uuid(), attempt: Attempt };

const Hello = z.strictObject({
  type: z.literal('hello'),
  runnerVersion: z.string().min(1).max(50),
  platform: RunnerPlatform,
  concurrencyLimit: z.int().min(1).max(16),
  clis: z.array(CliStatus).max(4),
  activeRuns: z.array(z.strictObject(RunAttempt)).max(MAX_ACTIVE_RUNS),
});

const RunEvents = z.strictObject({
  type: z.literal('run.events'),
  ...RunAttempt,
  events: z
    .array(z.strictObject({ seq: z.int().min(1), event: RunnerRunEventBody }))
    .min(1)
    .max(MAX_EVENTS_PER_MESSAGE)
    .refine(
      (events) =>
        events.every((entry, index) => index === 0 || entry.seq > (events[index - 1]?.seq ?? 0)),
      'events must be in increasing seq order',
    ),
});

const RunHeartbeat = z.strictObject({ type: z.literal('run.heartbeat'), ...RunAttempt });

const RunnerStatusMessage = z.strictObject({
  type: z.literal('runner.status'),
  planLimitResetsAt: z.iso.datetime().nullable(),
});

export const RunnerToServerMessage = z.discriminatedUnion('type', [
  Hello,
  RunEvents,
  RunHeartbeat,
  RunnerStatusMessage,
]);
export type RunnerToServerMessage = z.infer<typeof RunnerToServerMessage>;

const Welcome = z.strictObject({
  type: z.literal('welcome'),
  runnerId: z.uuid(),
  heartbeatIntervalMs: z.int().min(1),
  runs: z
    .array(z.strictObject({ ...RunAttempt, valid: z.boolean(), ackedSeq: z.int().min(0) }))
    .max(MAX_ACTIVE_RUNS),
});

const Prompt = z.string().min(1).max(RUN_PROMPT_MAX);

export const TestJob = z.strictObject({
  kind: z.literal('test'),
  repository: Repository,
  ref: GitRef,
  prompt: Prompt,
});
export type TestJob = z.infer<typeof TestJob>;

export const SETUP_FILES_MAX = 64;
export const SETUP_FILE_CONTENT_MAX = 65_536;

export const SetupFile = z.strictObject({
  path: SkillFilePath,
  content: z.string().max(SETUP_FILE_CONTENT_MAX),
});
export type SetupFile = z.infer<typeof SetupFile>;

/** Everything a setup run needs, rendered and checked by the API when the setup starts. */
export const SetupJob = z
  .strictObject({
    kind: z.literal('setup'),
    repository: Repository,
    commit: CommitSha,
    defaultBranch: GitRef,
    prompt: Prompt,
    inputs: z.string().max(SETUP_INPUTS_MAX),
    files: z.array(SetupFile).max(SETUP_FILES_MAX),
    moveSkills: z.array(SkillName).max(200),
    templateSkills: z.array(SkillName).max(32),
    generateSkills: z.array(SkillName).max(32),
  })
  .refine(
    (job) => jsonByteLength(job) <= SETUP_JOB_MAX_BYTES,
    `must serialize to at most ${SETUP_JOB_MAX_BYTES} bytes`,
  );
export type SetupJob = z.infer<typeof SetupJob>;

export const RunJob = z.discriminatedUnion('kind', [TestJob, SetupJob]);
export type RunJob = z.infer<typeof RunJob>;

const RunAssign = z.strictObject({ type: z.literal('run.assign'), ...RunAttempt, job: RunJob });

const RunCancel = z.strictObject({ type: z.literal('run.cancel'), ...RunAttempt });

const RunAck = z.strictObject({ type: z.literal('run.ack'), ...RunAttempt, seq: z.int().min(0) });

const RunHeartbeatReply = z.strictObject({
  type: z.literal('run.heartbeat_reply'),
  ...RunAttempt,
  valid: z.boolean(),
  cancelRequested: z.boolean(),
});

export const ServerToRunnerMessage = z.discriminatedUnion('type', [
  Welcome,
  RunAssign,
  RunCancel,
  RunAck,
  RunHeartbeatReply,
]);
export type ServerToRunnerMessage = z.infer<typeof ServerToRunnerMessage>;

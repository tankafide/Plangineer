import { z } from 'zod';
import { base } from './base.ts';
import { PageInput, pageOutput } from './pagination.ts';

export const RunStatus = z.enum([
  'queued',
  'leased',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly RunStatus[];

export const RunFailureReason = z.enum([
  'agent_error',
  'exit_code',
  'invalid_output',
  'plan_limit',
  'cli_unavailable',
  'checkout_failed',
  'skills_drift',
  'lease_lost',
  'runner_stopped',
  'protocol_error',
  'event_buffer_full',
  'timeout',
  'setup_invalid_output',
  'setup_publish_failed',
  'skill_missing',
  'attachment_failed',
]);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

export const RunCancelReason = z.enum(['requested', 'runner_revoked']);
export type RunCancelReason = z.infer<typeof RunCancelReason>;

/** What a run does. The kind sets the job the runner gets and what its agent may change. */
export const RunKind = z.enum(['test', 'setup', 'pre_planning']);
export type RunKind = z.infer<typeof RunKind>;

const REPOSITORY_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const Repository = z.strictObject({
  owner: z.string().regex(REPOSITORY_OWNER, 'must be a GitHub user or organization name'),
  name: z
    .string()
    .regex(REPOSITORY_NAME, 'must be a GitHub repository name')
    .refine((name) => name !== '.' && name !== '..', 'must be a GitHub repository name'),
});
export type Repository = z.infer<typeof Repository>;

const RepositoryOutput = z.object({ owner: z.string(), name: z.string() });

/** A branch, tag or commit. The leading-dash rule stops a ref being read as a git option. */
export const GitRef = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._/-]+$/, 'may hold only letters, digits, ., _, / and -')
  .regex(/^[^-/]/, 'must not start with - or /')
  .refine((ref) => !ref.includes('..'), 'must not contain ..');

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, 'must be a full commit hash');

const RunRunner = z.object({
  id: z.uuid(),
  name: z.string(),
  online: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  planLimitResetsAt: z.iso.datetime().nullable(),
});

export const RunSummary = z.object({
  id: z.uuid(),
  kind: RunKind,
  status: RunStatus,
  repository: RepositoryOutput,
  ref: z.string(),
  attempt: z.int(),
  cancelRequested: z.boolean(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  commit: z.string().nullable(),
  runner: RunRunner,
});
export type RunSummary = z.infer<typeof RunSummary>;

export const Run = RunSummary.extend({ prompt: z.string() });
export type Run = z.infer<typeof Run>;

export const RUN_PROMPT_MAX = 20_000;

export const RunCreateInput = z.strictObject({
  runnerId: z.uuid(),
  repository: Repository,
  ref: GitRef,
  prompt: z.string().min(1).max(RUN_PROMPT_MAX),
});
export type RunCreateInput = z.input<typeof RunCreateInput>;

const RunIdInput = z.strictObject({ runId: z.uuid() });

export const runCreate = base
  .errors({ NOT_FOUND: { status: 404 }, CONFLICT: { status: 409 } })
  .input(RunCreateInput)
  .output(Run);

export const runGet = base
  .errors({ NOT_FOUND: { status: 404 } })
  .input(RunIdInput)
  .output(Run);

export const runList = base.input(PageInput).output(pageOutput(RunSummary));

export const runCancel = base
  .errors({ NOT_FOUND: { status: 404 }, CONFLICT: { status: 409 } })
  .input(RunIdInput)
  .output(Run);

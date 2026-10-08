import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  type CliStatus,
  type RepositoryScan,
  type RoleSettings,
  type RunEvent,
  RunEventType,
  RunKind,
  RunnerLoginStatus,
  RunnerPlatform,
  RunnerStatus,
  RunStatus,
  type SetupJob,
  type SetupSelection,
  SetupStatus,
  type WorkflowSettings,
} from '@plangineer/contracts';
import { user } from './auth-schema.ts';

export * from './auth-schema.ts';

export const runnerStatus = pgEnum('runner_status', RunnerStatus.enum);
export const runnerPlatform = pgEnum('runner_platform', RunnerPlatform.enum);
export const runnerLoginStatus = pgEnum('runner_login_status', RunnerLoginStatus.enum);
export const runStatus = pgEnum('run_status', RunStatus.enum);
export const runEventType = pgEnum('run_event_type', RunEventType.enum);
export const runKind = pgEnum('run_kind', RunKind.enum);
export const setupStatus = pgEnum('setup_status', SetupStatus.enum);

const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const id = () =>
  uuid()
    .default(sql`uuidv7()`)
    .primaryKey();

/** A revoked runner keeps its row, because runs point at it. */
export const runners = pgTable(
  'runners',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    platform: runnerPlatform().notNull(),
    tokenHash: text().notNull(),
    status: runnerStatus().default('active').notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    lastSeenAt: timestamp({ withTimezone: true }),
    concurrencyLimit: integer(),
    runnerVersion: text(),
    clis: jsonb()
      .$type<CliStatus[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    planLimitResetsAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('runners_token_hash_key').on(table.tokenHash),
    check('runners_name_length_check', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      'runners_revoked_at_check',
      sql`(${table.revokedAt} IS NOT NULL) = (${table.status} = 'revoked')`,
    ),
    check(
      'runners_concurrency_limit_check',
      sql`${table.concurrencyLimit} IS NULL OR ${table.concurrencyLimit} BETWEEN 1 AND 16`,
    ),
    // Serves runner.list.
    index('runners_user_id_id_idx').on(table.userId, table.id),
  ],
);

/**
 * A runner's request to pair. Belongs to no user until a member approves it, and completes once,
 * when the runner's poll collects its token. Secrets are stored only as hashes.
 */
export const runnerLogins = pgTable(
  'runner_logins',
  {
    id: id(),
    deviceSecretHash: text().notNull(),
    userCodeHash: text().notNull(),
    name: text().notNull(),
    platform: runnerPlatform().notNull(),
    status: runnerLoginStatus().default('pending').notNull(),
    userId: uuid().references(() => user.id, { onDelete: 'cascade' }),
    runnerId: uuid().references(() => runners.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('runner_logins_device_secret_hash_key').on(table.deviceSecretHash),
    unique('runner_logins_user_code_hash_key').on(table.userCodeHash),
    unique('runner_logins_runner_id_key').on(table.runnerId),
    check('runner_logins_name_length_check', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      'runner_logins_user_id_check',
      sql`(${table.userId} IS NOT NULL) = (${table.status} IN ('approved', 'completed'))`,
    ),
    check(
      'runner_logins_runner_id_check',
      sql`(${table.runnerId} IS NOT NULL) = (${table.status} = 'completed')`,
    ),
    index('runner_logins_user_id_idx').on(table.userId),
    // Serves the pending count and the cleanup delete.
    index('runner_logins_expires_at_idx').on(table.expiresAt),
  ],
);

/** The dispatch record. attempt is the fencing token, and cancel_requested is never cleared. */
export const runs = pgTable(
  'runs',
  {
    id: id(),
    kind: runKind().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runnerId: uuid()
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    repositoryOwner: text().notNull(),
    repositoryName: text().notNull(),
    ref: text().notNull(),
    prompt: text().notNull(),
    status: runStatus().default('queued').notNull(),
    attempt: integer().default(0).notNull(),
    leaseExpiresAt: timestamp({ withTimezone: true }),
    cancelRequested: boolean().default(false).notNull(),
    lastEventId: integer().default(0).notNull(),
    commit: text(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('runs_prompt_length_check', sql`char_length(${table.prompt}) BETWEEN 1 AND 20000`),
    check('runs_attempt_check', sql`${table.attempt} >= 0`),
    check(
      'runs_lease_check',
      sql`(${table.leaseExpiresAt} IS NOT NULL) = (${table.status} IN ('leased', 'running'))`,
    ),
    check(
      'runs_started_at_check',
      sql`${table.status} IN ('failed', 'cancelled') OR (${table.startedAt} IS NOT NULL) = (${table.status} IN ('running', 'succeeded'))`,
    ),
    check(
      'runs_ended_at_check',
      sql`(${table.endedAt} IS NOT NULL) = (${table.status} IN ('succeeded', 'failed', 'cancelled'))`,
    ),
    // Serves run.list.
    index('runs_user_id_id_idx').on(table.userId, table.id),
    // Serves the runner foreign key.
    index('runs_runner_id_idx').on(table.runnerId),
    // Serves the active-run count in the claim and the cancel scan in dispatch.
    index('runs_runner_id_active_idx')
      .on(table.runnerId)
      .where(sql`${table.status} IN ('leased', 'running')`),
    // Serves the claim.
    index('runs_claimable_idx')
      .on(table.runnerId, table.id)
      .where(sql`${table.status} = 'queued'`),
    // Serves the sweeper.
    index('runs_lease_expires_at_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} IN ('leased', 'running')`),
  ],
);

/** Append-only: no update or delete path exists. */
export const runEvents = pgTable(
  'run_events',
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    eventId: integer().notNull(),
    attempt: integer().notNull(),
    runnerSeq: integer(),
    type: runEventType().notNull(),
    payload: jsonb().$type<RunEvent>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Serves SSE resume and the run foreign key.
    unique('run_events_run_id_event_id_key').on(table.runId, table.eventId),
    // De-duplicates runner events.
    unique('run_events_run_id_attempt_runner_seq_key').on(
      table.runId,
      table.attempt,
      table.runnerSeq,
    ),
    check(
      'run_events_runner_seq_check',
      sql`${table.runnerSeq} IS NULL OR ${table.type} NOT IN ('run.queued', 'run.leased', 'run.cancel_requested', 'run.lease_lost')`,
    ),
  ],
);

/** One row per configured repository: the MVP's Repository settings record. Mutable. */
export const repositories = pgTable(
  'repositories',
  {
    id: id(),
    githubRepositoryId: bigint({ mode: 'number' }).notNull(),
    githubInstallationId: bigint({ mode: 'number' }).notNull(),
    owner: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    roleSettings: jsonb().$type<RoleSettings>().notNull(),
    workflowSettings: jsonb().$type<WorkflowSettings>().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('repositories_github_repository_id_key').on(table.githubRepositoryId),
    check(
      'repositories_description_length_check',
      sql`char_length(${table.description}) BETWEEN 1 AND 200`,
    ),
    // Serves the created_by foreign key.
    index('repositories_created_by_idx').on(table.createdBy),
  ],
);

/** One setup per repository, replaced by each scan and deleted with its repository. */
export const repositorySetups = pgTable(
  'repository_setups',
  {
    id: id(),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    status: setupStatus().notNull(),
    scan: jsonb().$type<RepositoryScan>().notNull(),
    selection: jsonb().$type<SetupSelection>(),
    job: jsonb().$type<SetupJob>(),
    runId: uuid().references(() => runs.id, { onDelete: 'set null' }),
    pullRequestNumber: integer(),
    pullRequestUrl: text(),
    failureMessage: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Serves the lookup by repository and its foreign key.
    unique('repository_setups_repository_id_key').on(table.repositoryId),
    // Serves the lookup by run and its foreign key.
    unique('repository_setups_run_id_key').on(table.runId),
    check(
      'repository_setups_started_check',
      sql`${table.status} = 'scanned' OR (${table.selection} IS NOT NULL AND ${table.job} IS NOT NULL)`,
    ),
    check(
      'repository_setups_pull_request_pair_check',
      sql`(${table.pullRequestNumber} IS NULL) = (${table.pullRequestUrl} IS NULL)`,
    ),
    check(
      'repository_setups_pull_request_check',
      sql`${table.status} NOT IN ('pr_open', 'complete') OR ${table.pullRequestNumber} IS NOT NULL`,
    ),
    check(
      'repository_setups_failure_message_check',
      sql`(${table.failureMessage} IS NOT NULL) = (${table.status} = 'failed')`,
    ),
    check(
      'repository_setups_failure_message_length_check',
      sql`char_length(${table.failureMessage}) <= 2000`,
    ),
  ],
);

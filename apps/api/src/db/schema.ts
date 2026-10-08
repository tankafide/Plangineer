import { relations, sql } from 'drizzle-orm';
import {
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
  type RunEvent,
  RunEventType,
  RunnerPlatform,
  RunnerStatus,
  RunStatus,
  UserRole,
} from '@plangineer/contracts';

export const userRole = pgEnum('user_role', UserRole.enum);

export const user = pgTable('user', {
  id: uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: userRole('role').default('member').notNull(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const runnerStatus = pgEnum('runner_status', RunnerStatus.enum);
export const runnerPlatform = pgEnum('runner_platform', RunnerPlatform.enum);
export const runStatus = pgEnum('run_status', RunStatus.enum);
export const runEventType = pgEnum('run_event_type', RunEventType.enum);

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

/** Immutable apart from used_at. Stored only as a hash, used once, and expires. */
export const runnerPairingCodes = pgTable(
  'runner_pairing_codes',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique('runner_pairing_codes_code_hash_key').on(table.codeHash),
    // Serves the per-user rate-limit count.
    index('runner_pairing_codes_user_id_created_at_idx').on(table.userId, table.createdAt),
  ],
);

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

/** The dispatch record. attempt is the fencing token, and cancel_requested is never cleared. */
export const runs = pgTable(
  'runs',
  {
    id: id(),
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

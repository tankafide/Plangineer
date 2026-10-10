import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  type RepositoryScan,
  type RoleSettings,
  RunMode,
  type SetupJob,
  type SetupSelection,
  SetupStatus,
} from '@plangineer/contracts';
import { user } from './auth-schema.ts';
import { createdAt, id, updatedAt } from './columns.ts';
import { runs } from './runs-schema.ts';

export const setupStatus = pgEnum('setup_status', SetupStatus.enum);
export const runMode = pgEnum('run_mode', RunMode.enum);

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
    defaultRunMode: runMode().default('manual').notNull(),
    /** Stored when the repository is added and refreshed by each scan, so features need no GitHub call. */
    defaultBranch: text().notNull(),
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
    check(
      'repositories_default_branch_length_check',
      sql`char_length(${table.defaultBranch}) BETWEEN 1 AND 255`,
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

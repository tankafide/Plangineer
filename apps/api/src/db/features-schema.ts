import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
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
  AttachmentMediaType,
  FeatureState,
  type PrePlanningJob,
  PrePlanningTaskKind,
} from '@plangineer/contracts';
import { user } from './auth-schema.ts';
import { bytea, createdAt, id, updatedAt } from './columns.ts';
import { repositories, runMode } from './repositories-schema.ts';
import { runs } from './runs-schema.ts';

export const featureState = pgEnum('feature_state', FeatureState.enum);
export const prePlanningTaskKind = pgEnum('pre_planning_task_kind', PrePlanningTaskKind.enum);
export const attachmentMediaType = pgEnum('attachment_media_type', AttachmentMediaType.enum);

/** The root of a change, owned by its author and deleted with them. Mutable. */
export const features = pgTable(
  'features',
  {
    id: id(),
    authorId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text().notNull(),
    ticketUrl: text(),
    exploreCodebase: boolean().notNull(),
    runMode: runMode().notNull(),
    state: featureState().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('features_title_length_check', sql`char_length(${table.title}) BETWEEN 1 AND 81`),
    check(
      'features_description_length_check',
      sql`char_length(${table.description}) BETWEEN 1 AND 50000`,
    ),
    // Serves feature.list and the author check.
    index('features_author_id_id_idx').on(table.authorId, table.id),
    // Serves the sweeper's repair of features left in pre_planning.
    index('features_pre_planning_idx')
      .on(table.id)
      .where(sql`${table.state} = 'pre_planning'`),
    // Serves the sweeper's start of planning for Auto loop features left in plan_ready.
    index('features_auto_plan_ready_idx')
      .on(table.id)
      .where(sql`${table.state} = 'plan_ready' AND ${table.runMode} = 'auto_loop'`),
  ],
);

/** One row per repository a feature involves. Immutable. */
export const featureRepositories = pgTable(
  'feature_repositories',
  {
    id: id(),
    featureId: uuid()
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    // Serves the feature detail join, and the tasks' composite foreign key.
    unique('feature_repositories_feature_id_repository_id_key').on(
      table.featureId,
      table.repositoryId,
    ),
    // Serves repository.remove's check for features.
    index('feature_repositories_repository_id_idx').on(table.repositoryId),
  ],
);

/** A file the engineer attached to a feature, deleted with it. Immutable. */
export const featureAttachments = pgTable(
  'feature_attachments',
  {
    id: id(),
    featureId: uuid()
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    mediaType: attachmentMediaType().notNull(),
    sizeBytes: integer().notNull(),
    content: bytea().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'feature_attachments_name_length_check',
      sql`char_length(${table.name}) BETWEEN 1 AND 200`,
    ),
    check(
      'feature_attachments_size_bytes_check',
      sql`${table.sizeBytes} = octet_length(${table.content}) AND ${table.sizeBytes} BETWEEN 1 AND 10485760`,
    ),
    // Serves the detail list and the cascade.
    index('feature_attachments_feature_id_idx').on(table.featureId),
  ],
);

/** One intake, exploration or research task of a feature, run as one pre_planning run. Immutable. */
export const prePlanningTasks = pgTable(
  'pre_planning_tasks',
  {
    id: id(),
    featureId: uuid()
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    kind: prePlanningTaskKind().notNull(),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    topic: text(),
    job: jsonb().$type<PrePlanningJob>().notNull(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'pre_planning_tasks_feature_repository_fk',
      columns: [table.featureId, table.repositoryId],
      foreignColumns: [featureRepositories.featureId, featureRepositories.repositoryId],
    }).onDelete('cascade'),
    check(
      'pre_planning_tasks_topic_length_check',
      sql`char_length(${table.topic}) BETWEEN 1 AND 190`,
    ),
    check(
      'pre_planning_tasks_topic_check',
      sql`(${table.kind} = 'research') = (${table.topic} IS NOT NULL)`,
    ),
    // Serves dispatch's join and the run-end lookup.
    unique('pre_planning_tasks_run_id_key').on(table.runId),
    // Serves the detail list and the plan-ready check.
    index('pre_planning_tasks_feature_id_idx').on(table.featureId),
    // Serves the repository foreign key's check on repository delete.
    index('pre_planning_tasks_repository_id_idx').on(table.repositoryId),
  ],
);

/** A task's answer, which the engineer edits. Reaches its feature through its task. Mutable. */
export const contextFiles = pgTable(
  'context_files',
  {
    id: id(),
    taskId: uuid()
      .notNull()
      .references(() => prePlanningTasks.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    content: text().notNull(),
    ticked: boolean().default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Serves the detail list's join from tasks, and makes the insert idempotent.
    unique('context_files_task_id_key').on(table.taskId),
    check('context_files_title_length_check', sql`char_length(${table.title}) BETWEEN 1 AND 200`),
    check(
      'context_files_content_length_check',
      sql`char_length(${table.content}) BETWEEN 1 AND 65536`,
    ),
  ],
);

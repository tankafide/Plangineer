import { sql } from 'drizzle-orm';
import {
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
  type PlanBody,
  type PlanDecision,
  type PlanningJob,
  PlanningTurnKind,
  PlanRevisionSource,
  PlanSection,
  type QuestionDraft,
  SectionAction,
} from '@plangineer/contracts';
import { user } from './auth-schema.ts';
import { createdAt, id } from './columns.ts';
import { contextFiles, features } from './features-schema.ts';
import { repositories } from './repositories-schema.ts';
import { runs } from './runs-schema.ts';

export const planningTurnKind = pgEnum('planning_turn_kind', PlanningTurnKind.enum);
export const planSection = pgEnum('plan_section', PlanSection.enum);
export const sectionAction = pgEnum('section_action', SectionAction.enum);
export const planRevisionSource = pgEnum('plan_revision_source', PlanRevisionSource.enum);

/**
 * One planning run of a feature, deleted with it. Immutable except `decisions`, which the apply
 * step sets once from a questions output.
 */
export const planningTurns = pgTable(
  'planning_turns',
  {
    id: id(),
    featureId: uuid()
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    kind: planningTurnKind().notNull(),
    section: planSection(),
    action: sectionAction(),
    stepId: uuid(),
    instruction: text(),
    job: jsonb().$type<PlanningJob>().notNull(),
    inputs: text().notNull(),
    decisions: jsonb().$type<PlanDecision[]>(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'planning_turns_section_check',
      sql`(${table.kind} = 'section_action') = (${table.section} IS NOT NULL)`,
    ),
    check(
      'planning_turns_action_check',
      sql`(${table.section} IS NULL) = (${table.action} IS NULL)`,
    ),
    check(
      'planning_turns_step_id_check',
      sql`(${table.kind} = 'revise_step') = (${table.stepId} IS NOT NULL)`,
    ),
    check(
      'planning_turns_instruction_check',
      sql`(${table.kind} = 'revise_step') = (${table.instruction} IS NOT NULL)`,
    ),
    check(
      'planning_turns_instruction_length_check',
      sql`char_length(${table.instruction}) BETWEEN 1 AND 2000`,
    ),
    check(
      'planning_turns_inputs_length_check',
      sql`char_length(${table.inputs}) BETWEEN 1 AND 2000000`,
    ),
    check(
      'planning_turns_decisions_check',
      sql`${table.kind} = 'guided' OR ${table.decisions} IS NULL`,
    ),
    // Serves dispatch's join, the inputs route and run-end lookups.
    unique('planning_turns_run_id_key').on(table.runId),
    // Serves the latest turn of a feature, and the feature foreign key.
    index('planning_turns_feature_id_id_idx').on(table.featureId, table.id),
  ],
);

/** The ticked context files a turn read, with their titles when it was queued. Immutable. */
export const planningTurnContextFiles = pgTable(
  'planning_turn_context_files',
  {
    id: id(),
    turnId: uuid()
      .notNull()
      .references(() => planningTurns.id, { onDelete: 'cascade' }),
    contextFileId: uuid()
      .notNull()
      .references(() => contextFiles.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'planning_turn_context_files_title_length_check',
      sql`char_length(${table.title}) BETWEEN 1 AND 200`,
    ),
    // Serves the turn's list and the turn foreign key.
    unique('planning_turn_context_files_turn_id_context_file_id_key').on(
      table.turnId,
      table.contextFileId,
    ),
    // Serves the context file cascade.
    index('planning_turn_context_files_context_file_id_idx').on(table.contextFileId),
  ],
);

/** A question a turn asked, deleted with it. Only the answer columns change, once. */
export const planQuestions = pgTable(
  'plan_questions',
  {
    id: id(),
    turnId: uuid()
      .notNull()
      .references(() => planningTurns.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    section: planSection().notNull(),
    prompt: text().notNull(),
    choices: jsonb().$type<QuestionDraft['choices']>().notNull(),
    recommended: integer().notNull(),
    answerChoice: integer(),
    answerText: text(),
    answeredAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check('plan_questions_position_check', sql`${table.position} BETWEEN 0 AND 4`),
    check(
      'plan_questions_prompt_length_check',
      sql`char_length(${table.prompt}) BETWEEN 1 AND 2000`,
    ),
    check('plan_questions_recommended_check', sql`${table.recommended} BETWEEN 0 AND 3`),
    check('plan_questions_answer_choice_check', sql`${table.answerChoice} BETWEEN 0 AND 3`),
    check(
      'plan_questions_answer_text_length_check',
      sql`char_length(${table.answerText}) BETWEEN 1 AND 4000`,
    ),
    check(
      'plan_questions_answer_check',
      sql`num_nonnulls(${table.answerChoice}, ${table.answerText}) <= 1`,
    ),
    check(
      'plan_questions_answered_at_check',
      sql`(${table.answeredAt} IS NULL) = (${table.answerChoice} IS NULL AND ${table.answerText} IS NULL)`,
    ),
    // Serves the turn's question list and the turn foreign key.
    unique('plan_questions_turn_id_position_key').on(table.turnId, table.position),
  ],
);

/** One version of a feature's plan. Immutable: each change inserts the next number (D5). */
export const planRevisions = pgTable(
  'plan_revisions',
  {
    id: id(),
    featureId: uuid()
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    body: jsonb().$type<PlanBody>().notNull(),
    source: planRevisionSource().notNull(),
    turnId: uuid().references(() => planningTurns.id, { onDelete: 'cascade' }),
    authorId: uuid().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    check('plan_revisions_number_check', sql`${table.number} >= 1`),
    check(
      'plan_revisions_turn_id_check',
      sql`(${table.source} = 'agent') = (${table.turnId} IS NOT NULL)`,
    ),
    check(
      'plan_revisions_author_id_check',
      sql`(${table.source} = 'engineer') = (${table.authorId} IS NOT NULL)`,
    ),
    // Serves the latest revision, plan.revision and the next number.
    unique('plan_revisions_feature_id_number_key').on(table.featureId, table.number),
    // Serves plan.revisions paging.
    index('plan_revisions_feature_id_id_idx').on(table.featureId, table.id),
    // Serve the turn and author foreign keys.
    index('plan_revisions_turn_id_idx').on(table.turnId),
    index('plan_revisions_author_id_idx').on(table.authorId),
  ],
);

/** The context files a revision was built from, with their titles then. Immutable. */
export const planRevisionContextFiles = pgTable(
  'plan_revision_context_files',
  {
    id: id(),
    revisionId: uuid()
      .notNull()
      .references(() => planRevisions.id, { onDelete: 'cascade' }),
    contextFileId: uuid()
      .notNull()
      .references(() => contextFiles.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'plan_revision_context_files_title_length_check',
      sql`char_length(${table.title}) BETWEEN 1 AND 200`,
    ),
    // Serves the revision's list and the revision foreign key.
    unique('plan_revision_context_files_revision_id_context_file_id_key').on(
      table.revisionId,
      table.contextFileId,
    ),
    // Serves the context file cascade.
    index('plan_revision_context_files_context_file_id_idx').on(table.contextFileId),
  ],
);

/** The commit a revision was planned against, one row per repository. Immutable. */
export const planRevisionRepositories = pgTable(
  'plan_revision_repositories',
  {
    id: id(),
    revisionId: uuid()
      .notNull()
      .references(() => planRevisions.id, { onDelete: 'cascade' }),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    baseCommit: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'plan_revision_repositories_base_commit_check',
      sql`${table.baseCommit} ~ '^[0-9a-f]{40}$'`,
    ),
    // Serves the revision's base commits and the revision foreign key.
    unique('plan_revision_repositories_revision_id_repository_id_key').on(
      table.revisionId,
      table.repositoryId,
    ),
    // Serves the repository foreign key.
    index('plan_revision_repositories_repository_id_idx').on(table.repositoryId),
  ],
);

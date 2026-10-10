---
name: data-model-design
description: Design Postgres tables with Drizzle, including immutable plan revisions, the append-only run_events table, identities, constraints, indexes and migrations. Use when planning, implementing or reviewing a table, constraint, index or migration.
disable-model-invocation: true
---

# Data model design

Tables, constraints, indexes and migrations in Postgres, written with Drizzle ORM 0.45 and Drizzle Kit. The schema lives in `apps/api`. This skill owns the schema and its migrations. `persistence` owns the queries, transactions, seed data and template-database tests that use it, and neither skill covers what the other owns.

## Rules

- **Identity.** Every table has a single `uuid` primary key defaulted with ``sql`uuidv7()` `` (Postgres 18), not `defaultRandom()`, so inserts append to the index. No composite or natural primary keys; a natural key is a `UNIQUE` constraint.
- **Foreign keys.** Every `.references()` passes an explicit `onDelete`, since Drizzle's default is `no action`. Postgres does not index a foreign key, so every foreign key column gets an index, or is the leading column of one, for joins and cascading deletes.
- **Time.** `timestamp(..., { withTimezone: true }).notNull().defaultNow()` for `created_at`. `updated_at` only on mutable tables, set with `$onUpdate(() => new Date())`. Never a zoneless `timestamp`.
- **Constraints belong in the database.** `NOT NULL`, `UNIQUE`, `check()` and foreign keys hold every rule they can, not only Zod. A column is nullable only when null has a meaning the product names. A unique constraint on a nullable column allows many nulls; use `.nullsNotDistinct()` or make it `NOT NULL`.
- **Text.** `text`, never `varchar(n)`. A length limit is a `check()` only when the product names it.
- **Enumerations.** Closed sets and state machines are `pgEnum` built from the `contracts` Zod enum (`pgEnum('run_status', RunStatus.options)`), so the values cannot drift. Never a text column with a hand-copied `CHECK`. Transitions are enforced in `domain`, not by triggers.
- **JSONB** only for a document the app reads and writes whole, such as a plan revision body. Type it with `.$type<T>()` from `contracts`, which is compile-time only, so the repository still parses with the Zod schema on the way in and out. Anything filtered, joined or constrained is a column.
- **Indexes.** One per query a plan names, saying which query it serves: equality columns first, then the sort column. A primary key or unique constraint is already an index, and a composite index serves queries on its leading column, so never duplicate either. No index without a query.
- **Names.** Tables plural `snake_case`, columns `snake_case`, with constraint and index names explicit. Set `casing: 'snake_case'` in both `drizzle.config.ts` and the `drizzle()` instance, so TypeScript keys stay camelCase. Better Auth's generated tables keep their singular names. Its generator emits `gen_random_uuid()` id defaults; change them to `uuidv7()`, and again after every rerun of `generate`.
- **No soft delete** unless the record is part of history the product shows. Delete rows, or let the foreign key cascade.

## The records

What each record owns and how it changes. A plan that adds a record not listed here adds a row in the same change.

| Record | Model |
| --- | --- |
| User | Better Auth owns its tables. Add the role (admin or member), the GitHub identity and notification preferences as columns, with no organization table |
| Runner | Belongs to one user. Stores a hashed pairing token and never the token, unique on the hash. Revoking sets a status and keeps the row, because runs point at it |
| GitHub App | One row, enforced by a unique `singleton` column with `check (singleton)`. Belongs to nothing and is never deleted by the app. Its client secret and private key are stored encrypted |
| Runner login request | Belongs to no user until a member approves it, then to the approver, and cascades with them. Its secrets are stored only as hashes. It completes once, and it is deleted an hour after it expires |
| Feature | The root of a change. Context files, pre-planning tasks, plan revisions, threads and runs belong to it. Its state is an enumerated column. Its repositories are rows of a join table, one per repository |
| Feature attachment | Belongs to a feature and cascades with it. Immutable. Holds the bytes as `bytea` with the name, media type and size |
| Pre-planning task | Belongs to a feature and cascades with it. Records the commit it ran against. Produces one context file |
| Context file | Belongs to a feature and cascades with it. Plan revisions record which context files they were built from in a join table |
| Plan revision | Immutable. Never updated: each edit inserts a row with the next `revision_number`, unique per plan. JSONB `body` plus columns for whatever is filtered or joined, such as the amendment level and the base commit per repository. One row is marked approved, enforced by a partial unique index |
| Thread message | Belongs to a plan, ordered by creation. Points at the plan revision any suggested change produced |
| Run | Belongs to a feature, and records its stage, runner, commit and skills. Holds the dispatch columns [run-orchestration](../run-orchestration/SKILL.md) needs for `FOR UPDATE SKIP LOCKED`, with a partial index on claimable rows |
| `run_events` | Append-only: no update or delete path exists. Indexed by run and event id for resume. The event id must let a reader tailing by id never skip a committed event, as [run-orchestration](../run-orchestration/SKILL.md) requires. Payload is JSONB, typed by the `RunEvent` contract |
| Finding | Belongs to a review run and points at a plan revision or a diff. Holds the fields in the finding format. The authoring fields (verdict, rule outcome, decision) are the only mutable columns |
| Approval | Immutable. Points at one plan revision and one reviewer, unique on the pair |
| Verification result | Immutable. Belongs to a verification run, one per acceptance criterion, unique on the pair. Evidence links point at storage keys |
| Repository settings | One row per repository, unique on the repository. Mutable, with `updated_at` |
| Repository setup | One per repository, unique on it, mutable, deleted with its repository. Holds the scan, the selection, the rendered job, the setup run and the pull request |
| Cross-repository orchestrator | Versioned like a plan revision: immutable rows with a revision number unique per stage. Each run records the revision it used |
| Staleness dismissal | Immutable. Points at a plan revision and a repository, and records the main commit and the overlapping files |
| Notification | Belongs to a recipient and points at one record. Only the read state changes. Deleted with the recipient |

## Migrations

- Generate with `drizzle-kit generate`, read the SQL, and commit it with the schema change. Never `drizzle-kit push`, never edit a committed migration, and hand-edit generated SQL only to add what the generator cannot express.
- Migrations apply inside a transaction and are recorded so each runs once. Never `.concurrently()` an index, since `CREATE INDEX CONCURRENTLY` fails inside a transaction.
- No data migration of old shapes at this stage. A breaking change drops and recreates, and `pnpm db:reset` rebuilds the dev database from migrations and seeds.
- Seed data lives with `persistence`. A migration adds the schema, never dev data.

## Plan mode

1. For each record the plan touches, list its table, columns with types and nullability, constraints, indexes and the query each index serves, as a table in the step.
2. State what each record owns and what deletes with it.
3. Decide how mutable or immutable it is, and record it under Decisions.
4. Name the migration step, and any seed rows it needs from `persistence`.

## Implement mode

Edit the Drizzle schema, generate the migration, read the SQL, and run `pnpm db:reset` to prove it applies from empty. Add an integration test for each constraint the plan names, on a real Postgres template database. Never write the queries here, since `persistence` owns them.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `data-model-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A step adds or changes a record with no table of columns, types, nullability, constraints and indexes | `blocker` |
| A plan that edits an immutable record (`run_events`, plan revisions, approvals) in place | `blocker` |
| A plan that stores a secret, such as a pairing token, in plain text | `blocker` |
| A rule the plan enforces only in Zod that a constraint could hold | `should fix` |
| An index with no query named, or a filtered or joined column with no index | `should fix` |
| JSONB planned for a field that is filtered or joined | `should fix` |
| No migration step, or no seed rows named where the dev stack needs them | `should fix` |
| Ownership or delete behavior of a new record left unstated | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `data-model-design` as the source skill.

| Check | Severity |
| --- | --- |
| A committed migration is edited, the schema changes with no migration, or `drizzle-kit push` is used | `blocker` |
| An immutable table (`run_events`, plan revisions) has an update or delete path | `blocker` |
| A secret, such as a pairing token, is stored in plain text | `blocker` |
| A rule enforced only in Zod that a constraint could hold | `should fix` |
| A foreign key without an explicit `onDelete` or an index, or a filtered column with no index | `should fix` |
| An enum whose values are copied by hand rather than built from the `contracts` Zod enum | `should fix` |
| An index no query uses or that duplicates another, or `timestamp` without a zone | `should fix` |
| JSONB used for a field that is filtered or joined | `should fix` |
| A migration that fails to apply from empty with `pnpm db:reset` | `should fix` |
| Naming breaks the convention | `nit` |

---
name: data-model-design
description: Designs database tables, identities, constraints, indexes and migrations, including immutable and append-only records. Use when planning, implementing or reviewing a table, constraint, index or migration.
disable-model-invocation: true
---

# Data model design

Tables, constraints, indexes and migrations. This skill owns the schema and its migrations, not the queries, transactions or seed data that use it.

<!-- slot: fact database-and-orm: the database engine and version, the ORM or query builder and version, and where the schema is defined -->

## Rules

- **Identity.** Every table has a single surrogate primary key. No composite or natural primary keys; a natural key is a `UNIQUE` constraint.
- **Foreign keys.** Every foreign key states its delete behavior. Every foreign key column is indexed, or is the leading column of an index, for joins and cascading deletes.
- **Time.** `created_at` on every table and `updated_at` only on mutable tables, both stored with a time zone in UTC.
- **Constraints belong in the database.** `NOT NULL`, `UNIQUE`, `CHECK` and foreign keys hold every rule they can, not only application validation. A column is nullable only when null has a meaning the product names.
- **Enumerations.** Closed sets and state machines are enforced by the database and built from the same source of values the application uses, so they cannot drift. Transitions are enforced in domain code, not by triggers.
- **JSON columns** only for a document the app reads and writes whole. The repository parses it with the shared schema on the way in and out. Anything filtered, joined or constrained is a column.
- **Indexes.** One per query a plan names, saying which query it serves: equality columns first, then the sort column. A primary key or unique constraint is already an index, and a composite index serves queries on its leading column, so never duplicate either. No index without a query.
- **No soft delete** unless the record is part of history the product shows. Delete rows, or let the foreign key cascade.

<!-- slot: rule schema-rules: rules for this database and ORM version: key type and default, timestamp, text and enum column types, JSON typing, naming and casing, and ORM default pitfalls -->

## Migrations

<!-- slot: fact migration-commands: the commands that generate, apply and reset migrations, and where migration files live -->

- Generate each migration with the migration tool, read the SQL, and commit it with the schema change. Never sync the schema without a migration file, never edit a committed migration, and hand-edit generated SQL only to add what the generator cannot express.
- Migrations are recorded so each runs once.
- A migration adds schema, never dev data.

## Plan mode

1. For each record the plan touches, list its table, columns with types and nullability, constraints, indexes and the query each index serves, as a table in the step.
2. State what each record owns and what deletes with it.
3. Decide how mutable or immutable it is, and record it under Decisions.
4. Name the migration step, and any seed rows it needs.

## Implement mode

Edit the schema, generate the migration, read the SQL, and run the reset command under Migrations to prove it applies from empty. Add an integration test for each constraint the plan names, on a real database of the same engine, as [testing](../testing/SKILL.md) sets. Never write the queries here.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `data-model-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A step adds or changes a record with no table of columns, types, nullability, constraints and indexes | `blocker` |
| A plan that edits an immutable or append-only record in place | `blocker` |
| A plan that stores a secret, such as a token or password, in plain text | `blocker` |
| A rule the plan enforces only in application validation that a constraint could hold | `should fix` |
| An index with no query named, or a filtered or joined column with no index | `should fix` |
| A JSON column planned for a field that is filtered or joined | `should fix` |
| No migration step, or no seed rows named where the dev environment needs them | `should fix` |
| Ownership or delete behavior of a new record left unstated | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `data-model-design` as the source skill.

| Check | Severity |
| --- | --- |
| A committed migration is edited, the schema changes with no migration, or the schema is synced without a migration file | `blocker` |
| An immutable or append-only table has an update or delete path | `blocker` |
| A secret, such as a token or password, is stored in plain text | `blocker` |
| A rule enforced only in application validation that a constraint could hold | `should fix` |
| A foreign key without an explicit delete behavior or an index, or a filtered column with no index | `should fix` |
| An enum whose values are copied by hand rather than built from the application's source of values | `should fix` |
| An index no query uses or that duplicates another, or a timestamp without a zone | `should fix` |
| A JSON column used for a field that is filtered or joined | `should fix` |
| A migration that fails to apply from empty with the reset command | `should fix` |
| Naming breaks the convention | `nit` |

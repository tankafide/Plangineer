---
name: persistence
description: Drizzle ORM queries, repositories, transactions, upserts and error mapping, seed data for pnpm dev and db:reset, and integration tests on Postgres template databases. Use when implementing or reviewing code that reads or writes the database. Schema and migrations belong to data-model-design.
disable-model-invocation: true
---

# Persistence

How code reads and writes Postgres through Drizzle ORM 0.45.2 or later on the 0.45 line. Tables, constraints, indexes and migrations belong to `data-model-design`, and run dispatch queries to `run-orchestration`. Load `data-model-design` when identity or lifecycle is unresolved.

## Implement mode

### Queries

- Queries live in repository modules in `apps/api`, beside the Drizzle schema. Only services call repositories (layers are in `api-server`).
- Select explicit columns. A repository returns a type from `packages/contracts`, or one mapped to it, never a raw row with columns the caller must not see.
- Parse every JSONB column with its `contracts` Zod schema on write and on read. `.$type<T>()` checks nothing at runtime.
- Use `.returning()` on insert and update instead of reading the row back.
- Every list query has a `limit` and an `orderBy` ending in a unique column. Paginate growing tables, such as `run_events`, by keyset (`gt(id, cursor)`), never by offset.
- No query in a loop. Load related rows with a join, `inArray`, or `db.query` with `with`, which runs as one query.
- Values only through Drizzle operators or the `sql` template, which parameterizes them. Never `sql.raw()` with input. A sort column or other identifier from a request maps through a fixed allowlist to a schema column, never into `sql.identifier()` or `.as()`.
- A repository that expects one row throws a typed not-found error. One that may find none returns `undefined`. Never an empty default.

### Transactions

- The service function for one business operation opens `db.transaction(async (tx) => ...)` and passes `tx` to each repository. Repositories take the handle as a parameter and never open or commit a transaction.
- Inside the callback, every query uses `tx`. A call on `db` there runs outside the transaction and on another connection.
- Roll back by throwing. Never catch inside the callback to carry on.
- No network, GitHub, S3 or agent call inside a transaction. Do the slow work first, then make the final state change atomic.
- Make retryable writes idempotent with `onConflictDoNothing` or `onConflictDoUpdate`, never read-then-insert. The `target` names the unique columns. For a partial unique index, also pass its predicate as `where`, or Postgres rejects the conflict target. Reference the proposed row with `` sql`excluded.<column>` ``.
- Take row locks with `.for('update')` only when correctness needs one, in the same order on every code path.
- Plan revisions are immutable: insert a new row, never update one. `run_events` is append-only: no update or delete.

### Errors

- Drizzle wraps driver failures in `DrizzleQueryError`. Read the Postgres error from its `cause`: `code` (`23505` unique, `23503` foreign key) and `constraint`.
- Map an expected violation to a typed error in the repository, keyed on the constraint name. Rethrow every other error unchanged. Map typed errors to oRPC errors at the API boundary, only where the contract names one.

### Seed data

- One seed module, called by both `pnpm dev` and `pnpm db:reset`.
- Deterministic: fixed ids and timestamps, no random values and no clock reads.
- Covers each state a screen or test needs, including empty, a stale plan and a failed run.
- Inserts through the app's repositories, so it cannot break a rule the app enforces.
- No real secrets, tokens or personal data.

### Integration tests

- Real Postgres, never PGlite or a mocked database. Vitest `globalSetup` migrates a template database once and closes its connection, since `CREATE DATABASE ... TEMPLATE` fails while anything is connected to the template. Each worker clones its own.
- Tests that need committed data, advisory locks or `FOR UPDATE SKIP LOCKED` get a database per file. Others may roll back a per-test transaction.
- On teardown, end the worker's pool, then drop its database.
- Cover what only the database shows: a unique conflict mapped to its typed error, a rollback after a failure mid-transaction, two concurrent writers.
- One CI path migrates from scratch instead of cloning the template, so migration drift shows.

## Review mode

Check a diff against these rules. Report each breach as a finding in the shared [finding format](../orchestrator-references/finding-format.md), with source skill `persistence`.

| Rule | Severity if broken |
| --- | --- |
| A query outside a repository, or in `packages/domain` or `apps/web` | blocker |
| SQL built by concatenation, `sql.raw()` with input, or an identifier from input | blocker |
| An update or delete of a plan revision or a `run_events` row | blocker |
| A query on `db` inside a transaction callback | blocker |
| A caught constraint error that continues as if the write succeeded | blocker |
| A network call, upload or agent call inside a transaction | blocker |
| A list query on a growing table with no `limit` | blocker |
| A list query with no unique tiebreaker in its order, or offset pagination on a growing table | should fix |
| A query inside a loop where one query would do | should fix |
| A repository that opens or commits a transaction | should fix |
| A read-then-insert where an upsert on a unique constraint is needed | should fix |
| A JSONB value written or read without its Zod schema | should fix |
| A raw row exposing columns the caller must not see, or a default in place of a missing row | should fix |
| A constraint error detected by message text, or mapped without checking the constraint name | should fix |
| Seed data that is random, time-dependent, bypasses the repositories, or holds a secret | should fix |
| An integration test that mocks the database or uses PGlite, rolls back where it needs committed data, or leaves its database behind | should fix |
| A conflict or concurrency path with no test against real Postgres | should fix |

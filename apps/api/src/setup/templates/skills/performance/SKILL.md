---
name: performance
description: Reviews a plan or diff for unbounded lists and queries, missing indexes, N+1 queries, background job and realtime load, and frontend bundle, request and render cost, and checks that the plan's constraints are met and measured. Used by plan review and implementation review.
disable-model-invocation: true
---

# Performance

Finds material performance problems, in a plan or in a diff. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `performance`, as `defect` only. Read [project-stack](../project-stack/SKILL.md) first. This skill checks the cost of what the design and code produce.

Raise a finding only when it ties to an observable cost: a query shape, a row count, a payload size, a request count or a render. A cost guess with no such link is a `nit` at most, marked unverified. When an index or query shape is in doubt, read the database's query plan on seeded data rather than guess.

## Load

<!-- slot: fact load-model: how the system is deployed and where load comes from: users, tenants, data stores, and the data that grows without limit -->

<!-- slot: fact hot-paths: the hot queries, endpoints, jobs, streams and screens, with the growing tables or collections each one reads or writes -->

## Backend and database

| Area | Check |
| --- | --- |
| Unbounded reads | Every list has a limit, a stable order and keyset pagination on a growing table. No list returns every child row of a growing parent. No exact count over a growing table on a hot path |
| Indexes | Every filter, join, sort and foreign key of a hot query has a matching index, in column order, in the migration. A new query that sequential-scans a growing table is a defect |
| N+1 | No query per item in a loop, in handlers, mappers or webhook processing. Use a join or a single query over the set of ids |
| Payloads | Select the columns the screen needs. Do not read large bodies or document columns when only a header is needed |
| Transactions | Short, with no network, model or file call inside. No transaction spans a long-running job |
| Writes | Append-only records are inserted in batches, not one round trip per item. No update to a hot row per event, such as a counter on a parent row |
| Request path | Independent awaits run concurrently. No heavy parsing, diffing or file work on the request path. Checks over large inputs are bounded by what changed, not the whole data set |
| Pool | The pool size covers handlers, workers and shared long-lived listeners. No connection held per idle subscriber |

## Background work and realtime

- **Queues and polling.** A job claim is one short transaction with a skip-locked claim or the queue's equivalent, a limit and an index on claimable rows. Idle workers must not multiply poll load. A heartbeat that rewrites a wide row, or a poll per worker per second on a large table, is a defect.
- **Streams.** Open streams share one source of updates. A query per open stream per tick, or a database listener per stream, is a defect. A resume from an old position reads bounded pages.
- **Retention.** An append-only table has a stated size and a plan for it, or the plan says why it needs none.
- **Clients and workers.** Sends over a long-lived connection are batched, and output buffers are bounded, so a noisy producer cannot flood the server or fill memory.

## Frontend

- **Bundle.** Routes are code split, so heavy libraries such as editors and diff viewers load only on the routes that use them. A new dependency's size is checked. A whole-library import for one function is a defect.
- **Requests.** No waterfalls: a route starts its queries in parallel rather than each component fetching after its parent renders. No request per list item. A filter or keystroke input is debounced. Retries are bounded.
- **Cache.** Realtime events patch the client cache, never refetch a whole list per event. Mutations invalidate only the keys they change.
- **Render.** Long timelines, logs and lists are windowed or paged. State that changes on every keystroke or drag lives in the smallest component that needs it. Memoization, virtualization or splitting is asked for only with evidence of measurable work.
- **Slow devices.** Large images, diffs and logs load on demand, so screens work on a mid-range phone and a slow network.

## Plan review mode

Check the plan, not code.

- Does a step add a list, query, table, stream or heavy screen? Then it states the bound, index, pagination and expected size.
- Is each constraint concrete, such as a latency, a size or a count? "Fast" is a defect.
- Does a "done when" line or the test plan measure each constraint, with a method and a threshold, such as a test on a seeded row count or a bundle size budget?
- Does any step design an unbounded read, a poll or tail per subscriber, or a write per event that the load would not survive?

| Severity | Examples |
| --- | --- |
| `blocker` | A designed unbounded read on a growing table, a poll or tail per subscriber, a write per event to a hot row, or a constraint the design cannot meet |
| `should fix` | A new list, query or stream with no stated bound, index or pagination, a vague constraint, or a constraint nothing measures |
| `nit` | An unverified cost concern |

A plan with no such work needs no performance finding.

## Implementation review mode

Check the diff and the plan's constraints.

- Read each changed query, handler and screen against the sections above. Check the index exists in the migration, not just in the plan.
- Where the plan states a constraint, confirm the code meets it and a test or measurement shows it.
- Each finding names the observable cost (the query, the row count it grows with, the payload or the request count) and the fix.

| Severity | Examples |
| --- | --- |
| `blocker` | An unbounded read on a growing table, a missing index on a hot query, a plan constraint the code cannot meet |
| `should fix` | An N+1, a per-subscriber query, a met but unmeasured constraint, a whole-library import, a route that eagerly loads a heavy library, offset pagination or no stable order on a growing table |
| `nit` | Unverified or minor cost, such as a rerender with no measurable effect |

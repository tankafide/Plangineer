---
name: performance
description: Review a plan or diff for unbounded lists and queries, missing indexes, N+1 queries, SSE and dispatch load on Postgres, and frontend bundle, request and render cost, and check that the plan's constraints are met and measured. Used by plan review and implementation review.
disable-model-invocation: true
---

# Performance

Finds material performance problems, in a plan or in a diff. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `performance`, as `defect` only. Read the [stack decisions](../../../docs/engineering/stack-decisions.md) first. The rules for tables, queries, dispatch and the client belong to `data-model-design`, `persistence`, `run-orchestration` and `frontend-data`. This skill checks the cost of what they produce.

One deployment per team runs one Postgres as database, queue and realtime source. Load comes from data that grows without limit: `run_events`, plan revisions, findings and features. Raise a finding only when it ties to an observable cost: a query shape, a row count, a payload size, a request count or a render. A cost guess with no such link is a `nit` at most, marked unverified. When an index or plan shape is in doubt, run `EXPLAIN` on the seeded database rather than guess.

## Backend and database

| Area | Check |
| --- | --- |
| Unbounded reads | Every list has a `limit`, a stable order and keyset pagination on a growing table. No list returns every event of a run. No exact `count(*)` over a growing table on a hot path |
| Indexes | Every filter, join, sort and foreign key of a hot query has a matching index, in column order, in the migration. The claim query on `runs` and the tail of `run_events` by run and event id have one. A new query that sequential-scans a growing table is a defect |
| N+1 | No query per item in a loop, in handlers, mappers or webhook processing. Use a join or `inArray` |
| Payloads | Select the columns the screen needs. Do not read plan revision bodies or event payloads (JSONB) when only a header is needed |
| Transactions | Short, with no network, model or file call inside. No transaction spans a run |
| Writes | Run events are inserted in batches, not one round trip per output line. No update to a hot row per event, such as a counter on `runs` |
| Request path | Independent awaits run together with `Promise.all`. No heavy parsing, diffing or file work on the request path. Staleness and amendment checks are bounded by the changed files and sections, not the whole repository |
| Pool | The pool size covers handlers, workers and the shared `LISTEN` connection. No connection held per idle subscriber |

## Dispatch and realtime

- **Dispatch.** The claim is one short transaction with `FOR UPDATE SKIP LOCKED`, a `limit` and a partial index on claimable rows. Idle runners must not multiply poll load. A heartbeat that rewrites a wide row, or a poll per runner per second on a large table, is a defect.
- **SSE.** Streams use the shared tail in [run-orchestration](../run-orchestration/SKILL.md). A query per open stream per tick, or a `LISTEN` connection per stream, is a defect. A resume from an old event id reads bounded pages.
- **Retention.** An append-only table, such as `run_events`, has a stated size and a plan for it, or the plan says why it needs none.
- **Runner.** Sends on its one WebSocket are batched, and output buffers are bounded, so a noisy agent cannot flood the server or fill memory.

## Frontend

- **Bundle.** Routes are split with the TanStack Router plugin's `autoCodeSplitting`, so CodeMirror, `react-diff-view` and dnd-kit load only on the routes that use them. A new dependency's size is checked. A whole-library import for one function is a defect.
- **Requests.** No waterfalls: a route loader starts its queries in parallel rather than each component fetching after its parent renders. No request per list item. A filter or keystroke input is debounced. Retries are bounded.
- **Cache.** SSE events patch the cache, never refetch a whole list per event. Mutations invalidate only the keys they change.
- **Render.** Run timelines, event logs and diffs are windowed or paged. State that changes on every keystroke or drag lives in the smallest component that needs it. Memoization, virtualization or splitting is asked for only with evidence of measurable work.
- **Phone.** Large images, diffs and logs load on demand, so the phone-first screens work on a mid-range phone and a slow network.

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
| `blocker` | An unbounded read on a growing table, a missing index on the claim or tail query, a plan constraint the code cannot meet |
| `should fix` | An N+1, a per-subscriber query, a met but unmeasured constraint, a whole-library import, a route that eagerly loads a heavy editor, offset pagination or no stable order on a growing table |
| `nit` | Unverified or minor cost, such as a rerender with no measurable effect |

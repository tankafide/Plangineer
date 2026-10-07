---
name: run-orchestration
description: Run dispatch in the runs table, leases, heartbeats and cancel flags, and realtime delivery over SSE and one WebSocket per runner.
disable-model-invocation: true
---

# Run orchestration

How `apps/api` hands agent runs to runners and streams their events. Dispatch lives in Postgres, with no queue library. Tables and migrations belong to [data-model-design](../data-model-design/SKILL.md), queries and transactions to [persistence](../persistence/SKILL.md). The runner's side is in [runner-adapters](../runner-adapters/SKILL.md), and the browser's side is in [frontend-data](../frontend-data/SKILL.md).

The plan that adds the `runs` table, the `run_events` table or a runner message decides its names and values: status set, event types, message types, route paths and the retry policy. This skill holds the rules those designs must follow.

## Implement mode

### The runs table is the queue

One row per agent execution, holding a status from a closed set, the leasing runner, the lease expiry, the last heartbeat, a cancel flag and an attempt counter.

- Status moves along transitions the plan defines, and a `WHERE` guard in the update rejects any other move. Pure transition rules live in `domain`. Claims and status changes live in one `apps/api` module.
- The cancel flag is set by the API and read by the runner. It is never cleared.
- The attempt counter increments on each lease. It is the fencing token that rejects a stale runner's writes.

### Dispatch

- Claim in one transaction: select the oldest queued run that fits the runner with `ORDER BY ... LIMIT ... FOR UPDATE SKIP LOCKED`, mark it leased to that runner with an expiry, then commit. Two runners can never claim one run.
- Respect each runner's concurrency limit and plan-limit state when choosing. Never dispatch to an offline runner.

### Leases and heartbeats

- A runner heartbeats on a fixed interval while a job runs. Each heartbeat extends the lease by the lease duration, which is at least three intervals.
- Lease expiry is set and compared with the database clock (`now()`), never the API's or the runner's clock.
- A sweeper runs on an interval and handles every run whose lease has lapsed, as the plan's retry policy says. It appends a RunEvent that records the lost lease.
- Every runner message carries the run's attempt. The API ignores and logs messages from an old attempt.
- Intervals, durations and attempt limits come from the Zod-parsed environment, never constants buried in code.

### Cancel

- The browser calls a cancel procedure, which sets the cancel flag and appends a RunEvent for the request in one transaction.
- The API pushes a cancel message over the runner's WebSocket. The flag stays the record: the runner also sees it on reconnect and in each heartbeat reply.
- A queued run is cancelled directly by the API, with no runner involved.
- A run ends as cancelled only when the runner reports its terminal event, or when the sweeper finds the lease lost after a cancel was requested.

### Events

- `run_events` is append-only. Never update or delete a row.
- Each event has an id that resume uses. A reader tailing by id must never skip a committed event. A plain sequence can commit out of order, so allocate the id per run while holding the run's row lock, for example by incrementing a counter on `runs` in the appending transaction.
- The runner numbers its events per run. A unique key on the run and that number makes a repeated runner message a no-op.
- Validate every payload with the RunEvent schema from `contracts` before inserting. An invalid event fails the run.
- Append the event and any status change in the same transaction, so a viewer never sees a status with no event behind it.

### One WebSocket per runner

- The runner dials the control plane with its pairing token, and the API checks the hash before accepting. The API never opens a connection to a runner.
- Upgrade with `upgradeWebSocket` from `@hono/node-server`, backed by a `ws` `WebSocketServer({ noServer: true })` passed to `serve`. `@hono/node-ws` is deprecated. Keep header-changing middleware such as CORS off the upgrade route.
- Parse every message in both directions with its `contracts` schema. A message that fails to parse closes the socket with code 1008 and a reason.
- The API acknowledges the highest runner event number it has stored, so the runner can resume after a reconnect.
- One socket per runner, replaced when the same runner reconnects. Ping on an interval and close sockets that miss it.

### SSE to browsers

- One route streams a run's events, with its path set by the contract. It first sends stored events with an id greater than `Last-Event-ID`, then tails new ones.
- Each API process runs one shared tail. The transaction that appends events calls `pg_notify` on a `run_events` channel with only the run id, since payloads cap at 8000 bytes. One dedicated `LISTEN` connection per process, outside the query pool, receives it, reads that run's new rows once with `id > last`, and fans them out to every open stream on the run.
- A new stream subscribes to the fan-out first, then reads its backlog after `Last-Event-ID` in bounded pages, and drops any event at or below the last id it sent. When the `LISTEN` connection reconnects, the tail reads each open run once to catch up on missed notifications.
- Postgres is the source of truth. Process memory holds only the last id per run and the open streams, never events as the only copy. Never poll per stream.
- Stream with Hono's `streamSSE`. Send each event with `id: <event id>`, send a comment heartbeat to keep proxies open, and end the stream after a terminal event. Keep compression middleware off the route, since it buffers.
- An error thrown inside the `streamSSE` callback never reaches `app.onError`. Pass its error handler, log there and close the stream.
- Authorize the stream like any other read. Bound the batch size, and unsubscribe from the fan-out in `stream.onAbort`.

### Tests

Integration tests use real Postgres on template databases. Cover two runners racing for one run, a lease expiring, a stale attempt rejected, cancel before and after claim, a duplicate runner event number, SSE resume after event N with no gap or repeat, and two streams on one run served by one read. Use the fake agent for end-to-end runs.

## Review mode

Raise findings with Source skill `run-orchestration`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| A queue library, an in-memory queue or a polling loop that claims without `FOR UPDATE SKIP LOCKED` | blocker |
| A claim outside one transaction, or a status move the guard does not check | blocker |
| A lease with no heartbeat extension, no sweeper, or no attempt check on runner messages | blocker |
| Lease expiry set or compared with an application clock instead of `now()` | should fix |
| `run_events` rows updated or deleted, or an event not validated against `contracts` | blocker |
| An event id that lets a tailing reader skip a committed event | blocker |
| An event and its status change in separate transactions | should fix |
| No unique key on the run and the runner's event number | should fix |
| SSE without event ids, without resume, or with in-memory events as the only copy | blocker |
| A query per open stream per tick, a `LISTEN` connection per stream, or `LISTEN` on a pooled connection | should fix |
| An SSE or WebSocket handler with no authorization, or that leaks on disconnect | blocker |
| A runner message defined outside `contracts`, or parsed with no schema | should fix |
| More than one WebSocket per runner, or the API dialing a runner | should fix |
| Cancel that only sets a flag nobody reads, or marks cancelled before the runner stops | should fix |
| Lease, heartbeat or retry values hard-coded instead of parsed from the environment | should fix |
| No integration test for a race, an expired lease or an SSE resume | should fix |

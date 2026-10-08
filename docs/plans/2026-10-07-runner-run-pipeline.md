# Runner and run pipeline plan

Oct 7, 2026

## Goal

Chunk 1 of the [MVP roadmap](mvp-roadmap.md): an engineer pairs a local runner, starts a test run from the app, and watches a `claude -p` run stream its events back. It covers pairing, the runner WebSocket, dispatch from the `runs` table, the Claude Code adapter, worktrees, limits, SSE and the move of `skills sync` and `skills check` into the runner. Features, repository records, hosted runners, Codex and npm publishing are left out.

## Steps

Names used across steps:

| Term | Meaning |
| --- | --- |
| Runner | One paired `plangineer-runner` install, a row in `runners` |
| Run | One agent execution, a row in `runs` |
| Run event | One row in `run_events`, typed by the `RunEvent` contract |
| Event id | The per-run integer the API allocates to each run event. SSE uses it as `id` |
| Runner sequence | The per-run, per-attempt integer the runner gives each event it sends, used to de-duplicate |
| Test run | A run started from the Runs screen with a runner, a repository, a ref and a prompt. Chunk 3 replaces it with feature tasks |
| Wake | A `pg_notify('runner_wake', <runner id>)` that tells the API process holding that runner's socket to dispatch and push cancels |

New dependencies, pinned exactly like the existing ones:

| Package | Version | Added to |
| --- | --- | --- |
| `ws` | 8.22.0 | `apps/api`, `apps/runner` |
| `@types/ws` | 8.18.2 | `apps/api`, `apps/runner` (dev) |
| `env-paths` | 4.0.0 | `apps/runner` |
| `eventsource-parser` | 4.1.1 | `packages/api-client` |
| `@orpc/client` | 1.15.5 | `apps/runner` |
| `execa` | 10.1.0 | `apps/runner` (moves from dev to runtime) |
| `pino` | 10.4.0 | `apps/runner` |
| `zod` | 4.6.5 | `apps/runner`, `packages/domain` |

### Phase 1: shared contracts and rules

### 1. Contracts

**Files:** `packages/contracts/src/runner.ts`, `packages/contracts/src/run.ts`, `packages/contracts/src/run-event.ts`, `packages/contracts/src/runner-protocol.ts`, `packages/contracts/src/pagination.ts`, `packages/contracts/src/index.ts`, and a `<name>.test.ts` beside each new file

Every shape follows `api-contract-design`. Datetimes are `z.iso.datetime()`. Ids are `z.uuid()`.

**Shared enums and values**

| Name | Values |
| --- | --- |
| `RunnerStatus` | `active`, `revoked` |
| `RunnerPlatform` | `win32`, `darwin`, `linux` |
| `RunStatus` | `queued`, `leased`, `running`, `succeeded`, `failed`, `cancelled` |
| `RunFailureReason` | `agent_error`, `exit_code`, `invalid_output`, `plan_limit`, `cli_unavailable`, `checkout_failed`, `skills_drift`, `lease_lost`, `runner_stopped`, `protocol_error`, `event_buffer_full` |
| `RunCancelReason` | `requested`, `runner_revoked` |
| `PermissionMode` | `plan` (the only value in this chunk, see D7) |
| `CLAUDE_CODE_MIN_VERSION` | `'2.1.284'` |
| `RUN_EVENTS_PATH` | `'/api/runs/:runId/events'`, with `runEventsPath(runId)` returning the filled path |

**Pagination (`pagination.ts`).** `PageInput = z.strictObject({ cursor: z.uuid().optional(), limit: z.int().min(1).max(100).default(50) })`. Lists order by `id` descending, since ids are `uuidv7()` and sort by creation time. The cursor is the last item's id. `pageOutput(item)` returns `z.object({ items: z.array(item), nextCursor: z.uuid().nullable() })`.

**Shapes**

- `Repository = z.strictObject({ owner, name })`. `owner` matches `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`. `name` matches `^[A-Za-z0-9._-]{1,100}$` and is not `.` or `..`.
- `GitRef = z.string().min(1).max(255)`, matching `^[A-Za-z0-9._/-]+$`, not starting with `-` or `/`, and containing no `..`. The leading-dash rule stops a ref being read as a git option.
- `CliStatus = z.object({ name: z.literal('claude-code'), version: z.string().max(50).nullable(), available: z.boolean(), minimumVersion: z.string().max(50) })`.
- `Runner = z.object({ id, name, platform, status, online: z.boolean(), lastSeenAt: nullable, planLimitResetsAt: nullable, concurrencyLimit: z.int().nullable(), clis: z.array(CliStatus), createdAt, revokedAt: nullable })`. `online` is true when `lastSeenAt` is within `RUNNER_OFFLINE_AFTER_MS`.
- `RunRunner = z.object({ id, name, online, lastSeenAt, planLimitResetsAt })`, the runner as a run shows it.
- `RunSummary = z.object({ id, status, repository, ref, attempt: z.int(), cancelRequested: z.boolean(), createdAt, startedAt: nullable, endedAt: nullable, commit: z.string().nullable(), runner: RunRunner })`.
- `Run = RunSummary.extend({ prompt: z.string() })`.

**Procedures.** Every one starts from `base`. Each error not in `base` is added with `.errors()` on the procedure.

| Procedure | Auth | Input | Output | Errors added |
| --- | --- | --- | --- | --- |
| `runner.createPairingCode` | Session | none | `{ code: string, expiresAt }` | `TOO_MANY_REQUESTS` (429) |
| `runner.pair` | Public, called by the runner | `{ code: string matching ^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$, name: string 1..100, platform: RunnerPlatform }` | `{ runnerId, token: string }` | `PAIRING_CODE_REJECTED` (401) |
| `runner.list` | Session | `PageInput` | `pageOutput(Runner)` | none |
| `runner.revoke` | Session | `{ runnerId }` | `Runner` | `NOT_FOUND` (404) |
| `run.create` | Session | `{ runnerId, repository: Repository, ref: GitRef, prompt: string 1..20000 }` | `Run` | `NOT_FOUND` (404), `CONFLICT` (409) |
| `run.get` | Session | `{ runId }` | `Run` | `NOT_FOUND` (404) |
| `run.list` | Session | `PageInput` | `pageOutput(RunSummary)` | none |
| `run.cancel` | Session | `{ runId }` | `Run` | `NOT_FOUND` (404), `CONFLICT` (409) |

A user sees and acts on only their own runners and runs. Another user's id returns `NOT_FOUND`, never `FORBIDDEN`, so ids do not leak. The pairing code format is 12 Crockford base32 characters in three groups, `XXXX-XXXX-XXXX`.

**RunEvent (`run-event.ts`).** `RunEventBody` is a discriminated union on `type`. `RunEvent = RunEventBody` and `{ id: z.int().min(1), runId, at }`, so the stored and streamed shape carries the event id. Every string an agent produces is capped at 65,536 characters, and the adapter truncates longer text and sets `truncated: true`.

| Type | Sent by | Fields |
| --- | --- | --- |
| `run.queued` | API | none |
| `run.leased` | API | `runnerId`, `attempt` |
| `run.started` | Runner | `commit: 40-hex string`, `cli: { name: 'claude-code', version }` |
| `agent.session` | Runner | `model: string`, `cliVersion: string`, `skills: string[]` (each 1..200, at most 500) |
| `agent.message` | Runner | `text`, `truncated`, `parentToolUseId: nullable` |
| `agent.tool_use` | Runner | `toolUseId`, `name`, `inputJson: string`, `truncated`, `parentToolUseId: nullable` |
| `agent.tool_result` | Runner | `toolUseId`, `isError: boolean`, `text`, `truncated` |
| `agent.rate_limit` | Runner | `status: 'allowed' \| 'allowed_warning' \| 'rejected'`, `resetsAt: nullable` |
| `agent.other` | Runner | `vendorType: string 1..100`, `json: string`, `truncated` |
| `run.cancel_requested` | API | none |
| `run.lease_lost` | API | `attempt`, `requeued: boolean` |
| `run.succeeded` | Runner | `resultText`, `truncated`, `costUsd: number nullable`, `durationMs: int`, `numTurns: int` |
| `run.failed` | Runner or API | `reason: RunFailureReason`, `message: string 1..2000`, `exitCode: int nullable`, `stderrTail: string[]` (at most 20 lines of 500 characters) |
| `run.cancelled` | Runner or API | `reason: RunCancelReason` |

`TERMINAL_RUN_EVENT_TYPES` lists `run.succeeded`, `run.failed` and `run.cancelled`.

**Runner protocol (`runner-protocol.ts`).** One discriminated union per direction on `type`. Run-scoped messages carry `runId` and `attempt`.

| Message | Direction | Fields |
| --- | --- | --- |
| `hello` | Runner to server | `runnerVersion`, `platform`, `concurrencyLimit: int 1..16`, `clis: CliStatus[]`, `activeRuns: { runId, attempt }[]` |
| `run.event` | Runner to server | `runId`, `attempt`, `seq: int ≥ 1`, `event: RunEventBody` restricted to runner-sent types |
| `run.heartbeat` | Runner to server | `runId`, `attempt` |
| `runner.status` | Runner to server | `planLimitResetsAt: nullable` |
| `welcome` | Server to runner | `runnerId`, `heartbeatIntervalMs`, `runs: { runId, attempt, valid: boolean, ackedSeq: int }[]` for each `activeRuns` entry |
| `run.assign` | Server to runner | `runId`, `attempt`, `job: { repository, ref, prompt, permissionMode }` |
| `run.cancel` | Server to runner | `runId`, `attempt` |
| `run.ack` | Server to runner | `runId`, `attempt`, `seq` (the highest runner sequence stored) |
| `run.heartbeat_reply` | Server to runner | `runId`, `attempt`, `valid: boolean`, `cancelRequested: boolean` |

Messages are JSON text frames of at most 1 MiB. Close codes: `1008` for a message that fails its schema, `4001` for a revoked runner, `4002` for a socket replaced by a newer one from the same runner.

**Done when:**

- 1a. Each new schema accepts a valid value and rejects each invalid field, including a ref that starts with `-`, a repository name of `..` and a prompt over 20,000 characters.
- 1b. Each output schema strips an unknown key, and no output schema has a token hash or pairing code hash field.
- 1c. A `run.event` message whose event has an API-only type, such as `run.leased`, fails to parse.

### 2. Domain package and run status rules

**Files:** `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/index.ts`, `packages/domain/src/run-status.ts`, `packages/domain/src/run-status.test.ts`, `knip.json`

Creates `@plangineer/domain` like `@plangineer/contracts`: one `exports` entry at `src/index.ts`, depending on `@plangineer/contracts` and `zod`. Adds `packages/domain: {}` to `knip.json`. The root Vitest projects glob already includes it, and dependency-cruiser already has its layout rule.

`run-status.ts` holds two pure functions:

- `nextRunStatus(current: RunStatus, eventType: RunEventBody['type']): { ok: true, status: RunStatus } | { ok: false }`. The allowed moves:

| From | Event | To |
| --- | --- | --- |
| `queued` | `run.leased` | `leased` |
| `queued` | `run.cancelled` | `cancelled` |
| `leased` | `run.started` | `running` |
| `leased` | `run.failed` | `failed` |
| `leased` | `run.cancelled` | `cancelled` |
| `running` | `run.succeeded` | `succeeded` |
| `running` | `run.failed` | `failed` |
| `running` | `run.cancelled` | `cancelled` |

Every other run event type leaves the status unchanged and is allowed only in `leased` or `running`, except `run.cancel_requested`, which is allowed in `queued`, `leased` and `running`. Any event on a terminal status returns `{ ok: false }`. The switch over event types ends in a `never` check.

- `leaseLostOutcome({ status, attempt, maxAttempts, cancelRequested }): { status: RunStatus, requeued: boolean, event: 'run.failed' | 'run.cancelled' | null }`. A lost lease after a cancel request ends `cancelled`. A lost lease on a `leased` run below `maxAttempts` goes back to `queued` with no terminal event. A lost lease on a `leased` run at `maxAttempts`, or on any `running` run, ends `failed` with reason `lease_lost` (D9).

**Done when:**

- 2a. `nextRunStatus` returns the table's status for each allowed move and `{ ok: false }` for every other pair, checked over every status and event type.
- 2b. `leaseLostOutcome` returns requeue, fail or cancel for each combination of status, attempt and cancel flag.

### 3. Database tables

**Files:** `apps/api/src/db/schema.ts`, `apps/api/drizzle/<generated>.sql`, `apps/api/drizzle/meta/*`, `apps/api/src/db/schema.test.ts`

Enums are built from the contract enums: `runner_status`, `runner_platform`, `run_status`, `run_event_type` (from the `RunEventBody` type options). Every foreign key column is indexed, alone or as the leading column.

**`runner_pairing_codes`.** Immutable apart from `used_at`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | `uuidv7()` |
| `user_id` | `uuid` | no | `user.id`, `onDelete: cascade` |
| `code_hash` | `text` | no | SHA-256 hex of the normalized code, unique `runner_pairing_codes_code_hash_key` |
| `expires_at` | `timestamptz` | no | |
| `used_at` | `timestamptz` | yes | Null means unused |
| `created_at` | `timestamptz` | no | `defaultNow()` |

Index `runner_pairing_codes_user_id_created_at_idx (user_id, created_at)` serves the rate-limit count.

**`runners`.** Mutable, with `updated_at`. A revoked runner keeps its row, because runs point at it.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | `uuidv7()` |
| `user_id` | `uuid` | no | Owner, `user.id`, `onDelete: cascade` |
| `name` | `text` | no | |
| `platform` | `runner_platform` | no | |
| `token_hash` | `text` | no | SHA-256 hex, unique `runners_token_hash_key` |
| `status` | `runner_status` | no | Default `active` |
| `revoked_at` | `timestamptz` | yes | Check `runners_revoked_at_check`: set exactly when `status = 'revoked'` |
| `last_seen_at` | `timestamptz` | yes | Null means never connected |
| `concurrency_limit` | `integer` | yes | Reported in `hello`. Null means never connected. Check 1 to 16 |
| `runner_version` | `text` | yes | Reported in `hello` |
| `clis` | `jsonb` | no | `CliStatus[]`, default `[]`, read whole |
| `plan_limit_resets_at` | `timestamptz` | yes | Null means no limit reported |
| `created_at`, `updated_at` | `timestamptz` | no | |

Index `runners_user_id_id_idx (user_id, id)` serves `runner.list`.

**`runs`.** Mutable dispatch record.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | `uuidv7()` |
| `user_id` | `uuid` | no | Creator, `user.id`, `onDelete: cascade` |
| `runner_id` | `uuid` | no | `runners.id`, `onDelete: cascade` |
| `repository_owner`, `repository_name`, `ref`, `prompt` | `text` | no | |
| `status` | `run_status` | no | Default `queued` |
| `attempt` | `integer` | no | Default 0. Increments on each lease. The fencing token |
| `lease_expires_at` | `timestamptz` | yes | Check `runs_lease_check`: set exactly when status is `leased` or `running` |
| `cancel_requested` | `boolean` | no | Default false. Never cleared |
| `last_event_id` | `integer` | no | Default 0. The event id counter |
| `commit` | `text` | yes | From `run.started` |
| `started_at`, `ended_at` | `timestamptz` | yes | Set by the `running` and terminal moves |
| `created_at`, `updated_at` | `timestamptz` | no | |

| Index | Columns | Serves |
| --- | --- | --- |
| `runs_user_id_id_idx` | `(user_id, id)` | `run.list` |
| `runs_runner_id_idx` | `(runner_id)` | The runner foreign key and the active-run count in the claim |
| `runs_claimable_idx` | `(runner_id, id) WHERE status = 'queued'` | The claim |
| `runs_lease_expires_at_idx` | `(lease_expires_at) WHERE status IN ('leased', 'running')` | The sweeper |

**`run_events`.** Append-only: no update or delete path exists.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | `uuidv7()` |
| `run_id` | `uuid` | no | `runs.id`, `onDelete: cascade` |
| `event_id` | `integer` | no | Unique `run_events_run_id_event_id_key (run_id, event_id)`, which serves SSE resume |
| `attempt` | `integer` | no | The run's attempt when appended |
| `runner_seq` | `integer` | yes | Null for API events. Unique `run_events_run_id_attempt_runner_seq_key (run_id, attempt, runner_seq)`, which de-duplicates runner events |
| `type` | `run_event_type` | no | |
| `payload` | `jsonb` | no | The whole `RunEvent`, parsed with its schema on write and read |
| `created_at` | `timestamptz` | no | |

Generate the migration with `pnpm --filter @plangineer/api db:generate` and read the SQL. No seed rows: step 15 creates the e2e user through Better Auth.

**Done when:**

- 3a. `pnpm db:reset` applies the new migration from empty.
- 3b. The database rejects a second runner with the same token hash, a revoked runner with no `revoked_at`, a run in `leased` with no lease expiry, and a second run event with the same run and event id.
- 3c. Deleting a user deletes their pairing codes, runners, runs and run events.

### Phase 2: control plane

API code follows `api-server`, `persistence` and `run-orchestration`. Each area is a folder: `apps/api/src/runners/` and `apps/api/src/runs/`, each with a `*-repository.ts` for queries, a `*-service.ts` for operations that own their transaction, and tests beside them. Procedures stay thin in `apps/api/src/rpc/router.ts`.

### 4. Environment and the realtime connection

**Files:** `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `apps/api/src/test/fixtures.ts`, `.env.example`, `apps/api/src/realtime/notifications.ts`, `apps/api/src/realtime/notifications.test.ts`, `apps/api/src/main.ts`

New required API variables, listed in `.env.example` with these values and parsed as integers like `API_PORT`:

| Variable | `.env.example` value | Rule |
| --- | --- | --- |
| `RUNNER_HEARTBEAT_INTERVAL_MS` | `10000` | 1,000 to 60,000 |
| `RUN_LEASE_DURATION_MS` | `30000` | At least 3 times the heartbeat interval |
| `RUNNER_OFFLINE_AFTER_MS` | `30000` | At least 3 times the heartbeat interval |
| `RUN_SWEEP_INTERVAL_MS` | `5000` | 1,000 to 60,000 |
| `RUN_MAX_ATTEMPTS` | `3` | 1 to 10 |
| `SSE_KEEPALIVE_INTERVAL_MS` | `15000` | 1,000 to 60,000 |
| `RUNNER_PAIRING_CODE_TTL_MS` | `600000` | 60,000 to 3,600,000 |

`notifications.ts` exports `createNotificationListener({ databaseUrl, logger })`. It opens one dedicated `pg` `Client` outside the pool, runs `LISTEN run_events` and `LISTEN runner_wake`, and lets callers subscribe per channel. Each payload is a run id or a runner id. When the connection drops it reconnects with capped backoff (1 s doubling to 30 s) and calls each channel's `onReconnect` callback so subscribers catch up. `main.ts` starts it and closes it on shutdown, after the server and before the pool.

**Done when:**

- 4a. The API refuses to start, naming the variable, when any new variable is missing, out of range, or a lease duration under 3 heartbeat intervals.
- 4b. A `pg_notify` on `runner_wake` or `run_events` reaches the listener's subscriber, and after the listener's connection is terminated it reconnects and calls `onReconnect`.

### 5. Run procedures, dispatch and the sweeper

**Files:** `apps/api/src/runs/run-repository.ts`, `apps/api/src/runs/run-events-repository.ts`, `apps/api/src/runs/run-service.ts`, `apps/api/src/runs/dispatch.ts`, `apps/api/src/runs/sweeper.ts`, tests beside each, `apps/api/src/rpc/router.ts`, `apps/api/src/rpc/router.test.ts`, `apps/api/src/test/fixtures.ts`

All status changes and event appends go through `appendRunEvent(tx, runId, body, { attempt, runnerSeq })` in `run-events-repository.ts`. Under the run row lock (`SELECT ... FOR UPDATE`), it checks `nextRunStatus` from `@plangineer/domain`, inserts with `event_id = last_event_id + 1` and `onConflictDoNothing` on `(run_id, attempt, runner_seq)`, and when a row returns, updates `last_event_id`, the status and its columns (`commit`, `started_at`, `ended_at`, clearing `lease_expires_at` on a terminal move) in the same transaction. It parses the event with `RunEvent` first, then calls `pg_notify('run_events', run_id)`.

- **`run.create`.** Rejects a runner the caller does not own with `NOT_FOUND` and a revoked runner with `CONFLICT`. Inserts the run as `queued` with a `run.queued` event, then sends a wake. An offline runner still accepts the run, which waits in the queue.
- **`run.get`** and **`run.list`.** The caller's runs, joined to the runner for `RunRunner`, `id` descending for the list.
- **`run.cancel`.** In one transaction: `CONFLICT` on a terminal run. Otherwise sets `cancel_requested`, appends `run.cancel_requested`, and for a `queued` run also appends `run.cancelled` with reason `requested`. Then sends a wake.
- **`claimRuns(runnerId)` in `dispatch.ts`.** One transaction: locks the runner row `FOR UPDATE`, which serializes claims per runner. Skips the runner unless it is `active`, online, has a `concurrency_limit`, and has no `plan_limit_resets_at` in the future. Counts its `leased` and `running` runs, then selects up to the free slots from `queued`, not cancel-requested runs, `ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED`. Each claimed run gets `attempt + 1`, `lease_expires_at = now() + RUN_LEASE_DURATION_MS` and a `run.leased` event. Returns the claimed runs with their jobs.
- **`sweepLapsedLeases()` in `sweeper.ts`.** Selects runs in `leased` or `running` with `lease_expires_at < now()` `FOR UPDATE SKIP LOCKED`, applies `leaseLostOutcome` with `RUN_MAX_ATTEMPTS`, and appends `run.lease_lost`, then the terminal event when there is one, in one transaction per run. A requeued run returns to `queued` with no lease and a wake for its runner. Step 7 schedules it.
- **Test factory.** `apps/api/src/test/fixtures.ts` gains `storeRunner(db, overrides)`, which inserts a runner row directly with a random token hash, so run tests need no pairing.

**Done when:**

- 5a. `run.create` stores a queued run with a `run.queued` event, and rejects another user's runner with `NOT_FOUND` and a revoked runner with `CONFLICT`.
- 5b. Two concurrent `claimRuns` calls for one runner with a limit of 2 and 3 queued runs lease exactly 2 runs, each once.
- 5c. `claimRuns` leases nothing for an offline runner, a revoked runner, or one with a plan limit in the future.
- 5d. A run whose lease lapses while `leased` is requeued with attempt kept, and fails with reason `lease_lost` at `RUN_MAX_ATTEMPTS` or when it was `running`.
- 5e. Cancelling a queued run ends it `cancelled` at once, cancelling a running run sets the flag and appends `run.cancel_requested`, and cancelling a terminal run returns `CONFLICT`.
- 5f. A lapsed lease after a cancel request ends the run `cancelled`.
- 5g. A runner event repeated with the same runner sequence appends one row, and event ids of one run are consecutive from 1.
- 5h. An event that `nextRunStatus` rejects, such as `run.started` on a `running` run, is not stored and the run ends `failed` with reason `protocol_error`.

### 6. Pairing and runner procedures

**Files:** `apps/api/src/runners/runner-repository.ts`, `apps/api/src/runners/runner-service.ts`, `apps/api/src/runners/pairing.ts`, `apps/api/src/runners/runner-service.test.ts`, `apps/api/src/rpc/router.ts`, `apps/api/src/rpc/router.test.ts`, `apps/api/src/logger.ts`

The exchange follows `auth-and-access` runner pairing.

- **`createPairingCode`.** Rejects with `TOO_MANY_REQUESTS` when the user created 5 or more codes in the last 10 minutes, counted with the database clock. Otherwise generates 12 characters from `crypto.randomInt` over the Crockford alphabet, stores the SHA-256 of the code without dashes, uppercased, with `expires_at = now() + RUNNER_PAIRING_CODE_TTL_MS`, and returns the formatted code once.
- **`pair`.** A public procedure. Normalizes the code, then in one transaction selects the unused, unexpired row by hash `FOR UPDATE`, sets `used_at`, generates a token of 32 bytes from `crypto.randomBytes` as base64url, and inserts the runner with the token's SHA-256 hash. A missing, used or expired code returns `PAIRING_CODE_REJECTED` with the same message, so the error tells an attacker nothing. The 60-bit code and its expiry stand in for a rate limit on this route (D12).
- **`list`.** The user's runners, `id` descending, keyset on the cursor. `online` is computed in SQL as `last_seen_at > now() - RUNNER_OFFLINE_AFTER_MS`.
- **`revoke`.** In one transaction: sets `status = 'revoked'` and `revoked_at = now()` (a second revoke returns the row unchanged), cancels each of the runner's `queued` runs with a `run.cancelled` event of reason `runner_revoked`, and sends a wake. The socket holder closes the socket with `4001` (step 7).
- **`findRunnerByToken(token)`** hashes the token and looks it up by the unique hash, returning only an `active` runner. Step 7 uses it at the handshake.
- **Logging.** `logger.ts` adds `*.code` and `*.token` and `req.headers.authorization` to the redact paths. Codes and tokens are never logged, put in a URL or returned twice.

**Done when:**

- 6a. A member creates a pairing code, and the runner pairs with it once and receives a token. The stored row holds only the token's hash.
- 6b. A second use of the code, an expired code and an unknown code each return `PAIRING_CODE_REJECTED`.
- 6c. A sixth pairing code inside 10 minutes returns `TOO_MANY_REQUESTS`.
- 6d. `runner.list` returns only the caller's runners, pages with `nextCursor`, and shows `online` from `last_seen_at`.
- 6e. Revoking a runner marks it revoked, cancels its queued runs with reason `runner_revoked`, and returns `NOT_FOUND` for another user's runner.
- 6f. A request with no session gets `UNAUTHORIZED` from every runner procedure except `pair`.

### 7. Runner WebSocket

**Files:** `apps/api/src/runners/runner-socket.ts`, `apps/api/src/runners/runner-connections.ts`, `apps/api/src/runners/runner-socket.test.ts`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/web/vite.config.ts`

- **Route.** `GET /api/runners/socket`, upgraded with `upgradeWebSocket` from `@hono/node-server`, backed by `new WebSocketServer({ noServer: true, maxPayload: 1048576 })` from `ws` and passed to `serve` as `websocket.server`. The route reads `Authorization: Bearer <token>` and answers `401` before the upgrade unless `findRunnerByToken` returns an active runner.
- **Connections.** `runner-connections.ts` keeps one socket per runner id in this process. A new socket for the same runner closes the old one with `4002`. The process subscribes to `runner_wake`: for a runner whose socket it holds, a revoked runner's socket is closed with `4001`, and otherwise `dispatchRunner(runnerId)` runs.
- **`dispatchRunner(runnerId)`.** Calls `claimRuns`, sends `run.assign` with `permissionMode: 'plan'` for each claimed run, and sends `run.cancel` for each of the runner's `leased` or `running` runs with `cancel_requested` that this socket has not yet been told about.
- **`hello`.** Stores `concurrency_limit`, `runner_version`, `clis` and `last_seen_at = now()`. Replies with `welcome`: `heartbeatIntervalMs` from the environment, and for each `activeRuns` entry `valid` (the run is `leased` or `running` at that attempt) and `ackedSeq` (the highest stored runner sequence for that attempt). Then calls `dispatchRunner`.
- **`run.event`.** Ignores and logs a message whose attempt is not the run's current attempt, or whose run belongs to another runner. Otherwise calls `appendRunEvent` and replies `run.ack` with the highest stored sequence.
- **`run.heartbeat`.** For the current attempt, extends `lease_expires_at = now() + RUN_LEASE_DURATION_MS`. Replies `run.heartbeat_reply` with `valid` and `cancelRequested`.
- **`runner.status`.** Stores `plan_limit_resets_at`.
- **Sweeper.** Each API process runs `sweepLapsedLeases` every `RUN_SWEEP_INTERVAL_MS`, then calls `dispatchRunner` for every runner whose socket it holds, which also resumes a runner whose plan limit has passed. `main.ts` stops the interval on shutdown.
- **Liveness.** The API pings every `RUNNER_HEARTBEAT_INTERVAL_MS`, sets `last_seen_at = now()` on each pong, and terminates a socket that missed the previous ping.
- **Errors.** A message that fails its schema closes the socket with `1008` and the first Zod issue as the reason. The upgrade route has no CORS or compression middleware.
- **Dev proxy.** `vite.config.ts` proxies `/api` with `ws: true`, so the runner pairs and connects through the web origin in dev as in production.

**Done when:**

- 7a. A paired runner connects, sends `hello`, gets `welcome`, and receives `run.assign` for its queued run.
- 7b. A handshake with an unknown or revoked token gets `401`, and revoking a connected runner closes its socket with `4001`.
- 7c. A second socket for the same runner closes the first with `4002`.
- 7d. A malformed message closes the socket with `1008`.
- 7e. A runner event with a stale attempt is ignored, and a valid one is stored and acknowledged with `run.ack`.
- 7f. Heartbeats extend the lease, and a heartbeat reply reports `cancelRequested` after `run.cancel`.
- 7g. Cancelling a running run pushes `run.cancel` to the runner's socket, including when the socket is held by another `createApp` instance on the same database.
- 7h. `welcome` after a reconnect reports `ackedSeq` and `valid` for each active run.

### 8. Run event stream

**Files:** `apps/api/src/runs/run-event-stream.ts`, `apps/api/src/runs/run-event-tail.ts`, `apps/api/src/runs/run-event-stream.test.ts`, `apps/api/src/app.ts`

- **Route.** `GET` on `RUN_EVENTS_PATH`, using Hono's `streamSSE`. It resolves the session like `/rpc/*`, returns `401` without one and `404` for a run the caller does not own. `Last-Event-ID` must be a non-negative integer, otherwise `400`.
- **Tail (`run-event-tail.ts`).** One per process, fed by the `run_events` channel of step 4. Process memory holds only the last event id read per run and the open streams. On a notification it reads that run's rows with `event_id > last` once, in pages of 500, and fans them out to every open stream on the run. On listener reconnect it reads each open run once.
- **Stream.** Subscribes to the tail first, then sends the backlog after `Last-Event-ID` in pages of 500, dropping anything at or below the last id it sent. Each SSE message has `id: <event id>`, `event: run-event` and the `RunEvent` JSON as data. A comment line goes out every `SSE_KEEPALIVE_INTERVAL_MS`. The stream ends after a terminal event, and a run already terminal ends the stream after its backlog. `stream.onAbort` unsubscribes. Errors go to `streamSSE`'s error handler, which logs and closes.

**Done when:**

- 8a. A stream with `Last-Event-ID: 5` receives events 6 onward with no gap or repeat, then live events as they are appended.
- 8b. Two streams on one run are served by one read per notification.
- 8c. The stream ends after the terminal event, and a stream opened on a finished run sends its backlog and ends.
- 8d. The route returns `401` with no session, `404` for another user's run and `400` for a non-integer `Last-Event-ID`.

### Phase 3: runner

Runner code follows `runner-adapters`, `cross-platform` and the vendor login rule in `auth-and-access`. Folders under `apps/runner/src/` group by area: `skills/`, `config/`, `adapters/`, `worktrees/`, `connection/`, `jobs/`, `process/`.

### 9. Skills commands move into the runner

**Files:** `apps/runner/src/skills/skills-mirror.ts`, `apps/runner/src/skills/skills-mirror.test.ts`, `apps/runner/src/cli.ts`, `apps/runner/src/cli.test.ts`, `apps/runner/package.json`, `package.json`, `scripts/verify.mjs`, `lefthook.yml`, `scripts/sync-skills.mjs` (deleted), `scripts/sync-skills.test.mjs` (deleted), `.agents/skills/cross-platform/SKILL.md`, `.agents/skills/tooling-and-infra/SKILL.md`, `.agents/skills/runner-adapters/SKILL.md`

- Port `scripts/sync-skills.mjs` to TypeScript with the same behavior and its tests: `planSync`, `applySync`, the working-tree and git-index readers, LF normalization, binary files left alone, symlink refusal, and the drift message naming each file and the fix. Git runs through `execa` with an argument array. `scripts/compare-text.mjs` stays, since `scripts/lint-skills.mjs` uses it, and the runner gets its own comparison inside `skills-mirror.ts`.
- Export `checkSkillsMirror(repoRoot)` for step 11, returning `{ ok: true } | { ok: false, message }`.
- CLI commands: `skills sync`, `skills check` and `skills check --staged`, all on the current working directory.
- Root scripts: `skills:sync` becomes `node apps/runner/src/cli.ts skills sync`, `skills:check` becomes `node apps/runner/src/cli.ts skills check`. `scripts/verify.mjs` step 2 runs `apps/runner/src/cli.ts skills check`. `lefthook.yml` runs `node apps/runner/src/cli.ts skills check --staged`.
- Delete `scripts/sync-skills.mjs` and its test.
- Update the skill files that name the script: `cross-platform` line 18 points at `apps/runner/src/skills/skills-mirror.ts`, `tooling-and-infra` line 28 points at `scripts/lint-skills.test.mjs` as its example, and its "Temporary pieces" section and the switch-over sentence in `runner-adapters` are removed. Then `pnpm skills:sync` and `pnpm skills:lint`.

**Done when:**

- 9a. `plangineer-runner skills sync` and `skills check` pass every case the old script's tests covered, as runner tests.
- 9b. `pnpm skills:check`, `pnpm verify` and the lefthook pre-commit hook run the runner's command, and `scripts/sync-skills.mjs` no longer exists.

### 10. Runner configuration and pairing

**Files:** `apps/runner/src/config/runner-env.ts`, `apps/runner/src/config/runner-paths.ts`, `apps/runner/src/config/runner-credentials.ts`, `apps/runner/src/config/runner-logger.ts`, `apps/runner/src/pair-command.ts`, tests beside each, `apps/runner/src/cli.ts`, `apps/runner/package.json`, `package.json`

- **Environment.** `runner-env.ts` parses `process.env` once with Zod and exits naming any invalid variable. All are optional because each absence has one meaning:

| Variable | Absent means | Rule |
| --- | --- | --- |
| `PLANGINEER_RUNNER_DATA_DIR` | `envPaths('plangineer-runner', { suffix: '' }).data` | Absolute path |
| `PLANGINEER_RUNNER_CONCURRENCY` | 2 | Integer 1 to 16 |
| `PLANGINEER_CLAUDE_COMMAND` | `["claude"]` | JSON array of 1 to 10 non-empty strings |
| `PLANGINEER_GIT_BASE_URL` | `https://github.com` | URL with `https:` or `file:` |
| `LOG_LEVEL` | `info` | pino level |

`.env.example` lists them in a commented "Runner" section that says the runner reads its shell environment, not this file.

- **Paths.** Under the data directory: `runner.json`, `repos/<owner>/<name>.git`, `w/<run id>/<name>` and `logs/runner.log`. The `w` folder name keeps Windows paths short.
- **Credentials.** `runner.json` holds `{ serverUrl, runnerId, token }`, written with mode `0o600` through a temporary file and rename. It is parsed with Zod on read.
- **Logger.** pino JSON to stdout and `logs/runner.log`, redacting `token`, `code` and `authorization`.
- **`pair` command.** `plangineer-runner pair --server <url> --code <code> [--name <name>]`. The name defaults to `os.hostname()`. It calls `runner.pair` through an oRPC client from `@orpc/client` with `SimpleCsrfProtectionLinkPlugin`, writes `runner.json`, and prints "Paired as <name>. Start the runner with plangineer-runner start." A rejected code exits 1 with "That pairing code is invalid or expired. Create a new one in Plangineer."
- **Root script.** `pnpm runner` runs `node apps/runner/src/cli.ts`, so `pnpm runner pair ...` works from the checkout (D4).

**Done when:**

- 10a. The runner exits 1 naming the variable when `PLANGINEER_RUNNER_CONCURRENCY` is `0` or `PLANGINEER_CLAUDE_COMMAND` is not a JSON array.
- 10b. `pair` against a `node:http` test server on port 0 that answers `runner.pair` stores `runner.json` in the data directory, and a `PAIRING_CODE_REJECTED` answer exits 1 with the message and writes nothing. Pairing against the real API is proven in step 16.

### 11. Claude Code adapter, fake agent and fixtures

**Files:** `apps/runner/src/adapters/agent-adapter.ts`, `apps/runner/src/adapters/claude-code/claude-code-adapter.ts`, `apps/runner/src/adapters/claude-code/claude-code-mapping.ts`, `apps/runner/src/adapters/claude-code/child-env.ts`, `apps/runner/src/adapters/claude-code/fake-claude.ts`, `apps/runner/src/adapters/__fixtures__/claude-code/2.1.284/*.jsonl`, `apps/runner/src/process/stop-process.ts`, tests beside each, `knip.json`

- **Interface.** `AgentAdapter { name: 'claude-code'; detect(): Promise<CliStatus>; run(job: AgentJob, signal: AbortSignal): AsyncIterable<RunEventBody> }`, where `AgentJob = { prompt, cwd, permissionMode }`. Codex is the known second case.
- **`detect`.** Runs `<command> --version`, takes the first `\d+\.\d+\.\d+`, and marks the CLI unavailable when it is missing, fails, or is older than `CLAUDE_CODE_MIN_VERSION`.
- **Spawn.** `execa(command[0], [...command.slice(1), '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', job.permissionMode, '--permission-prompts', 'none'], { input: job.prompt, cwd: job.cwd, buffer: false, detached: process.platform !== 'win32', extendEnv: false, env: childEnv() })`. Never `--bare`.
- **Child environment.** `childEnv()` copies only allowlisted names from `process.env`, matching names case-insensitively so Windows `Path` keeps its key: `PATH`, `PATHEXT`, `SYSTEMROOT`, `COMSPEC`, `WINDIR`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_*`, `TERM`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` in both cases, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `ANTHROPIC_*` and `CLAUDE_*`. No `PLANGINEER_*` variable reaches the child. Values pass through unread.
- **Mapping (`claude-code-mapping.ts`).** Reads stdout line by line with `node:readline` (`crlfDelay: Infinity`):

| Claude line | Run event |
| --- | --- |
| `system` with subtype `init` | `agent.session` from `model`, `claude_code_version`, `skills` |
| `assistant` text block | `agent.message` |
| `assistant` `tool_use` block | `agent.tool_use`, with `input` serialized to `inputJson` |
| `user` `tool_result` block | `agent.tool_result` |
| `rate_limit_event` | `agent.rate_limit` from `rate_limit_info.status` and `resetsAt` (Unix seconds to ISO) |
| `result` with `is_error: false` and exit 0 | `run.succeeded` from `result`, `total_cost_usd`, `duration_ms`, `num_turns` |
| `result` with `is_error: true` | `run.failed`, reason `plan_limit` if a `rejected` rate limit was seen, else `agent_error` |
| Any other JSON line | `agent.other` with the line's `type` and subtype as `vendorType` |

`parent_tool_use_id` maps to `parentToolUseId`. A line that is not JSON stops the child and ends `run.failed` with reason `invalid_output`. An exit with no `result` ends `run.failed` with reason `exit_code`, the exit code and the last 20 stderr lines kept in a bounded buffer. Exactly one terminal event is yielded.

- **Stop (`stop-process.ts`).** `stopProcess(child)`: on macOS and Linux, `process.kill(-pid, 'SIGINT')`, then `SIGKILL` to the group if the child has not exited after 10 s. On Windows, `taskkill /pid <pid> /T /F` through `execa`. Aborting the adapter's signal calls it, and the adapter then yields `run.cancelled` with reason `requested`, whatever the CLI printed.
- **Fake agent (`fake-claude.ts`).** A Node script with the same command shape. `--version` prints `2.1.284 (Claude Code)`. Otherwise it reads the prompt from stdin, picks a scenario from a first line of `fake:<scenario>` (default `success`), and writes its fixture's lines 50 ms apart.

| Scenario | Behavior |
| --- | --- |
| `success` | `success-tools.jsonl`, exit 0 |
| `agent-error` | `agent-error.jsonl`, exit 1 |
| `rate-limit` | `synthetic-rate-limit-rejected.jsonl`, exit 1 |
| `crash` | Two lines of `success-tools.jsonl`, three stderr lines, exit 2, no `result` |
| `garbage` | One line of `success-tools.jsonl`, then `not json` |
| `crlf` | `success-tools.jsonl` with CRLF line endings |
| `hang` | The init line, then waits until signalled |
| `slow` | `success-tools.jsonl` with 500 ms between lines |

- **Fixtures.** Under `__fixtures__/claude-code/2.1.284/`. `success-tools.jsonl` and `agent-error.jsonl` are recorded from real runs (Verification, agent checks), with home paths, user names and session ids replaced by fixed placeholders. `synthetic-*.jsonl` files are edited from recorded lines, and `synthetic-rate-limit-rejected.jsonl` uses status `rejected` from the Agent SDK's rate limit type (D10). `knip.json` adds `src/adapters/claude-code/fake-claude.ts` as an `apps/runner` entry.

**Done when:**

- 11a. Each fixture maps to the expected run events, with exactly one terminal event: success, agent error, rate limit as `plan_limit`, CRLF, an unmapped type as `agent.other`, a non-JSON line as `invalid_output`, and an exit with no `result` as `exit_code` with the stderr tail.
- 11b. `detect` reports the fake agent's version as available, and a version below `2.1.284` or a missing command as unavailable.
- 11c. `childEnv` passes `PATH`, `ANTHROPIC_API_KEY` and `CLAUDE_CONFIG_DIR` and drops `PLANGINEER_RUNNER_DATA_DIR` and an unlisted variable.
- 11d. Aborting a `hang` run stops the child and its process group, and yields `run.cancelled` on Windows, macOS and Linux.
- 11e. `stopProcess` on Windows runs `taskkill` with `/pid <pid> /T /F`.

### 12. Worktrees

**Files:** `apps/runner/src/worktrees/worktrees.ts`, `apps/runner/src/worktrees/git.ts`, `apps/runner/src/worktrees/worktrees.test.ts`

- **`git.ts`.** Runs `git` through `execa` with an argument array, `GIT_TERMINAL_PROMPT=0` added to the environment so a missing credential fails at once, and `--end-of-options` before any ref. Git uses the engineer's own credentials (D5).
- **`prepareWorktree({ repository, ref, runId })`.** Serialized per repository with a promise chain keyed by `<owner>/<name>`. Clones `<PLANGINEER_GIT_BASE_URL>/<owner>/<name>.git` with `git clone --bare` into `repos/<owner>/<name>.git` if absent, setting `core.longpaths=true` and `remote.origin.fetch=+refs/heads/*:refs/heads/*`. Then `git fetch --prune --tags origin`, resolves the commit with `git rev-parse --verify --end-of-options <ref>^{commit}`, and runs `git worktree add --detach w/<runId>/<name> <commit>`. Returns `{ path, commit }`.
- **`removeWorktree(path)`.** Removes the folder with `fs.rm(path, { recursive: true, force: true, maxRetries: 5 })` after the child has exited, then runs `git worktree prune` on its bare clone. It runs for every run, whatever the outcome. No worktree command uses `--force`.
- A git failure returns its last 20 stderr lines for `run.failed` with reason `checkout_failed`.

**Done when:**

- 12a. Against a local bare repository through a `file:` base URL, `prepareWorktree` creates a detached worktree at the ref's commit outside the engineer's checkout, and a second run on the same repository reuses the clone after a fetch.
- 12b. Two `prepareWorktree` calls on one repository at once both succeed.
- 12c. An unknown ref fails with git's message, and `removeWorktree` leaves no folder and no entry in `git worktree list`.

### 13. Runner connection and job queue

**Files:** `apps/runner/src/connection/control-plane-socket.ts`, `apps/runner/src/jobs/job-queue.ts`, `apps/runner/src/jobs/run-job.ts`, `apps/runner/src/jobs/event-buffer.ts`, `apps/runner/src/start-command.ts`, `apps/runner/src/test/fake-control-plane.ts`, tests beside each, `apps/runner/src/cli.ts`

- **`start` command.** Reads `runner.json` (exits 1 with "This runner is not paired. Run plangineer-runner pair first." when absent), detects the CLIs, and dials `<serverUrl>/api/runners/socket` with the `ws` client and `Authorization: Bearer <token>`. It opens no inbound port.
- **Socket.** Sends `hello` on each connect with the platform, concurrency limit, CLI status and active runs. On `welcome` it drops buffered events at or below each `ackedSeq`, resends the rest, and stops any job marked `valid: false`. On a lost connection it reconnects with backoff from 1 s doubling to 30 s with full jitter, and running children keep running. A `401` handshake or a `4001` close stops every job and exits 1 with "This runner was revoked or its token is invalid. Pair it again with plangineer-runner pair."
- **Queue.** `job-queue.ts` accepts `run.assign` into memory and runs up to the concurrency limit. A `rejected` rate limit from any job pauses starting new jobs until its `resetsAt` and sends `runner.status` with it.
- **One job (`run-job.ts`).** In order: `prepareWorktree`, `checkSkillsMirror` on the worktree (drift ends `run.failed` with reason `skills_drift` and the drift message), the adapter's `detect` (unavailable ends `run.failed` with reason `cli_unavailable` and the needed version), `run.started` with the commit and CLI version, then the adapter's events. Every exit path removes the worktree. A cancel before the adapter starts yields `run.cancelled` with reason `requested`.
- **Events.** Each event gets the next runner sequence for the run and attempt, goes into `event-buffer.ts`, and is sent when connected. The buffer drops events once acknowledged and holds at most 10,000 unacknowledged events per run. Past that the job stops with `run.failed` reason `event_buffer_full`.
- **Heartbeats.** Every `heartbeatIntervalMs` for each assigned job. A reply with `valid: false` stops the job. A reply with `cancelRequested: true`, like a `run.cancel` message, aborts it.
- **Shutdown.** On `SIGINT` or `SIGTERM`, stops every job with `stopProcess`, sends `run.failed` with reason `runner_stopped` for each, waits up to 5 s for acknowledgements, then exits.

- **Test control plane.** `apps/runner/src/test/fake-control-plane.ts` is a `ws` server on port 0 for runner tests. It parses every message with the `contracts` protocol schemas, records them, acknowledges events, and lets a test send `run.assign` and `run.cancel`, answer heartbeats, drop the socket, or close it with `4001`. The runner's tests never start the real API, which `apps/runner` may not import. The real pipeline is proven end to end in step 16.

**Done when:**

- 13a. Given a `run.assign` for a local bare repository, the runner sends `run.started` and every fixture event in sequence order, ending in `run.succeeded`, and removes the worktree.
- 13b. With `PLANGINEER_RUNNER_CONCURRENCY=1` and two assigned runs, the second starts only after the first ends.
- 13c. A `run.cancel` during a `hang` run ends it with `run.cancelled` and stops the fake agent's process.
- 13d. When the socket drops during a `slow` run, the runner reconnects, sends `hello` with the run, and resends only events above the `ackedSeq` in `welcome`.
- 13e. A worktree with a drifted skills mirror ends the run with `run.failed` reason `skills_drift` before the agent starts.
- 13f. A `rate-limit` run ends with `run.failed` reason `plan_limit`, and the runner sends `runner.status` with the reset time and starts no queued job before it.
- 13g. A `4001` close makes `start` exit 1 with the revoked message.
- 13h. `SIGINT` to `start` during a `hang` run sends `run.failed` with reason `runner_stopped` and leaves no fake agent process running.

### Phase 4: web app

Web code follows `frontend-data`, `frontend-react`, `ui-design-system` and `visual-style`.

### 14. Client hooks

**Files:** `packages/api-client/src/runners.ts`, `packages/api-client/src/runs.ts`, `packages/api-client/src/run-events.ts`, tests beside each, `packages/api-client/src/index.ts`, `packages/api-client/package.json`

- Hooks: `useRunnerList` (infinite), `useCreatePairingCode`, `useRevokeRunner` (invalidates the runner list), `useRunList` (infinite), `useRun(runId)`, `useCreateRun` (invalidates the run list), `useCancelRun` (writes the returned run with `setQueryData`, invalidates the run list). None are optimistic.
- `useRunEvents(runId)` follows `frontend-data` live runs: `fetch` with `credentials: 'include'`, `EventSourceParserStream`, `Last-Event-ID` on every request, events kept in the query cache under the stream's key, an idempotent reducer keyed by event id, each event parsed with `RunEvent`, reconnect with capped backoff from 1 s to 30 s with jitter and at once when the page becomes visible, stop on a 4xx with `failed`, and on a terminal event abort, set `ended` and invalidate the run's detail key. It returns `{ events, status }` with status `connecting`, `live`, `reconnecting`, `ended` or `failed`.

**Done when:**

- 14a. Each hook calls its procedure with the oRPC key, and each mutation invalidates the keys listed above.
- 14b. `useRunEvents` resumes with `Last-Event-ID: 5` after a drop after event 5, applies no event twice, and parses an event split across chunks and CRLF line endings.
- 14c. `useRunEvents` reports `failed` on a `404` without reconnecting, and `ended` after a terminal event.

### 15. Screens

**Files:** `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/_app/index.tsx` (moved from `routes/index.tsx`), `apps/web/src/routes/_app/runners.tsx`, `apps/web/src/routes/_app/runs/index.tsx`, `apps/web/src/routes/_app/runs/$runId.tsx`, `apps/web/src/features/app-shell/app-header.tsx`, `apps/web/src/features/runners/*`, `apps/web/src/features/runs/*`, component tests beside each, `apps/web/src/components/ui/*` (added through the shadcn CLI: `badge`, `input`, `textarea`, `select`, `field`, `label`, `empty`, `item`)

- **Shell.** `_app.tsx` is a pathless layout that holds the session check now in `index.tsx` and renders `AppHeader` above the outlet. The header is one row with links Account, Runners and Runs, each at least 44 px tall. It stays one row at 375 px.
- **Runners (`/runners`).** Phone, one column:
  1. A "Pair a runner" card with a **Pair a runner** button. After a click it shows the command `pnpm runner pair --server <window.location.origin> --code <code>` in a monospace block with `break-all`, a **Copy command** button, the expiry time, and a **Done** button that hides it. A `TOO_MANY_REQUESTS` error shows "Too many pairing codes. Try again in a few minutes."
  2. One card per runner: name, platform, an Online or Offline badge with the last seen time, the Claude Code version or "Claude Code unavailable, needs 2.1.284 or later", the concurrency limit, a plan limit notice with its reset time, and Revoked with its date for a revoked runner. An active runner's card has a **Revoke** button that turns the card into a decision with **Revoke runner** and **Keep runner**.
  3. **Load more** when `nextCursor` is set.

  Desktop adds a two-column grid of runner cards from `md:`. States: a skeleton while loading, an empty state "No runners yet" pointing at the pair card, a failed alert with **Retry**, and stale data kept on screen with an "Out of date" marker as `AccountSummary` does.
- **Runs (`/runs`).** Phone, one column:
  1. A "New test run" form card: Runner (a select of active runners), Repository (`owner/name`), Ref, Prompt (a textarea), and **Start run**. Field errors show under each field from the contract's rules. Success opens the run page.
  2. One card per run: repository and ref, a status badge, the runner name and the created time, linking to the run page.
  3. **Load more** when `nextCursor` is set.

  Desktop puts the form in a left column of 24 rem and the list on the right from `lg:`. States: as on Runners, with the empty state "No runs yet".
- **Run (`/runs/$runId`).** Phone, one column:
  1. A details card: status badge, repository at ref, the commit's first 12 characters with the full value in a **Copy commit** button, runner, created, started and ended times, and the prompt. A queued run on an offline runner shows "Waiting for <runner>. It has been offline since <time>." A queued run on a plan-limited runner shows "<runner> reached its Claude plan limit. Runs resume after <time>." While not terminal it has a **Cancel run** button that turns the card into a decision with **Cancel run** and **Keep running**.
  2. A stream status line: Live, Reconnecting (styled as stale), Ended or Failed with **Retry**.
  3. The events in order, one row each: messages as wrapped text, tool uses with their name and a **Show input** button that expands the input, tool results, rate limit notices, lifecycle events, and `agent.other` with its vendor type. Truncated text says so.
  4. A result card: the result text, cost and duration for a success, or the reason, message, exit code and stderr tail for a failure.

  Desktop shows the details card in a sticky left column of 20 rem from `lg:`, with the events and result on the right. States: a skeleton while loading, "Run not found" for `NOT_FOUND`, a failed alert with **Retry**, and the stream's reconnecting state as stale.

**Done when:**

- 15a. The Runners screen shows the pairing command after **Pair a runner**, lists runners with online state and CLI status, and revokes a runner only after **Revoke runner** is confirmed.
- 15b. The Runs form blocks a ref starting with `-` and an invalid repository with field errors, and a valid submit opens the new run's page.
- 15c. The Run page shows each event kind, the offline and plan limit notices for a queued run, and cancels only after **Cancel run** is confirmed.
- 15d. Each screen shows its loading, empty, failed and stale states.
- 15e. Each screen has no horizontal scroll and no control under 44 px at 375 px, and its desktop layout matches this step at 1280 px.

### Phase 5: journeys and docs

### 16. End-to-end journey and docs

**Files:** `apps/api/src/test/e2e-session-cli.ts`, `apps/api/package.json`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/runner-test-run.spec.ts`, `apps/web/playwright.config.ts`, `scripts/runner-fake.mjs`, `package.json`, `knip.json`, `docs/engineering/stack-decisions.md`, `docs/plans/mvp-roadmap.md`

- **Signed-in sessions for journeys.** `e2e-session-cli.ts` (`pnpm --filter @plangineer/api e2e:session`) loads the `.env` like the API, stores a user with `storeUser` and prints the `sessionCookie` value as JSON. `global-setup.ts` runs it after the reset in `pnpm test:e2e` and writes a Playwright storage state that the new spec uses. The sign-in spec stays signed out. Both new files are `knip.json` entries.
- **Journey (`runner-test-run.spec.ts`).** In each project: create a local bare repository with one commit and a `.agents/skills` folder in sync with its mirror, open `/runners`, click **Pair a runner**, read the code from the page, run `node apps/runner/src/cli.ts pair` and then `start` through `execa` with a temporary `PLANGINEER_RUNNER_DATA_DIR`, `PLANGINEER_GIT_BASE_URL` set to the repository's `file:` URL and `PLANGINEER_CLAUDE_COMMAND` set to the fake agent. Then start a test run from `/runs` and see the events stream until Succeeded. A second test starts a `fake:hang` run, cancels it, and sees Cancelled. Each test stops its runner process.
- **`pnpm runner:fake`.** `scripts/runner-fake.mjs` runs the runner's `start` with `PLANGINEER_CLAUDE_COMMAND` set to the fake agent, so `pnpm dev` work and screenshot checks have runs without a model.
- **Docs.** `stack-decisions.md` adds `pnpm runner` and `pnpm runner:fake` to the commands table and replaces "the fake agent join it" in the `pnpm dev` row with a pointer to `pnpm runner:fake`. The roadmap's "Where things stand" rows for the skills mirror and the runner say what this chunk delivered.

**Done when:**

- 16a. `pnpm test:e2e` passes the pairing, successful run and cancelled run journeys in the `desktop-chromium` and `phone` projects.
- 16b. `pnpm runner:fake` serves a test run started from the app under `pnpm dev`.

## Decisions

All decisions were made on Oct 7, 2026. The engineer chose D1, D4, D5 and D14. The planner made the rest, and the engineer can overrule any of them.

- **D1. Test runs start jobs.** Chunk 1 has no features or repository records, so a Runs screen starts a run from a runner, a repository, a ref and a prompt. Chunk 3 replaces it with feature tasks. Rejected: an API-only trigger, which leaves the gate's "app sends a job" to a script, and keeping the screen as a lasting diagnostics tool, which is beyond the MVP.
- **D2. Runs target one runner.** The creator picks the runner, and dispatch claims only that runner's runs. Choosing a runner by owner, role and availability arrives with repository settings in chunk 2 and features in chunk 3. Runs carry no feature, stage, model, cost or skills columns yet. Those columns arrive with the chunks that read them. Cost and skills appear in the event log today.
- **D3. Runner kind is left out.** Every runner is local in this chunk. Hosted runners add the `kind` column in chunk 8.
- **D4. No npm publishing.** The runner runs from the checkout through `pnpm runner`. Node does not strip types under `node_modules`, so publishing needs a build step, which moves to rollout (chunk 10). `apps/runner` stays `"private": true`.
- **D5. Checkout uses the engineer's git credentials.** The runner keeps a bare clone per repository under its data directory and fetches before each job, over HTTPS with the engineer's credential helper. No GitHub token crosses the protocol. Hosted runners in chunk 8 need GitHub App installation tokens. Rejected: an installation token per job now, which needs the app installed on every test repository and adds token handling before it is needed.
- **D6. Worktrees are per run and removed when the run ends.** With no feature branch yet, each run checks out a detached worktree at the ref's commit. Removal deletes the folder and prunes, so no worktree command needs `--force`. Per-feature worktrees arrive in chunk 3.
- **D7. Permission mode `plan` for test runs.** Test runs read and answer, and nothing they produce is kept. Later stages set their own mode, and the contract enum grows with them.
- **D8. Pairing is code-first.** A member creates a 12-character code in the app and passes it to `plangineer-runner pair`. The code is one-time and expires after 10 minutes, so its appearance in shell history exposes nothing. Rejected: a device flow where the runner polls, which adds an unauthenticated polling route.
- **D9. Retry policy.** A run that loses its lease before `run.started` is requeued, up to `RUN_MAX_ATTEMPTS`. A run that loses it after starting fails with `lease_lost` and is never retried, because the agent may already have acted.
- **D10. Plan limit detection.** A `rate_limit_event` whose `rate_limit_info.status` is `rejected` means the plan limit is reached. The real Oct 7, 2026 run showed status `allowed` with `resetsAt` in Unix seconds. The `allowed_warning` and `rejected` values come from the Claude Agent SDK's rate limit type and could not be produced on demand while planning, so the synthetic fixture stands in for a recording. The runner pauses its queue and the API stops dispatching until `resetsAt`.
- **D11. Online means seen recently.** The API pings each socket every heartbeat interval and stores `last_seen_at` on each pong. A runner is online while `last_seen_at` is within `RUNNER_OFFLINE_AFTER_MS`, computed with `now()`. This keeps the state in Postgres for every API process.
- **D12. No rate limit on `runner.pair`.** A guess has one chance in 2^60 per code, and a code lives 10 minutes, so a limiter adds nothing. `createPairingCode` keeps its per-user limit of 5 per 10 minutes, a fixed rule in `pairing.ts`.
- **D13. Wakes cross API processes.** A `runner_wake` notification carries a runner id, and the process holding that runner's socket dispatches, pushes cancels and closes revoked sockets. The sweeper also dispatches every socket the process holds, which covers a missed notification and a plan limit that has passed.
- **D14. Cross-platform proof.** CI runs every runner test, including the fake agent and the process-group stop, on Windows, macOS and Linux. The engineer runs one real `claude -p` test run on Windows. Real runs on macOS and Linux are human checks for whoever next has those machines, and they do not block this chunk.
- **D15. Minimum Claude Code version 2.1.284.** That version, checked on Oct 7, 2026, has every flag the adapter passes, including `--permission-prompts none`. An older version is reported unavailable.
- **D16. `packages/domain` starts here.** Run status transitions and the lease-loss outcome are business rules, and staleness, triage and amendment levels follow in later chunks.
- **D17. Fixed runner limits.** The stop grace of 10 s, the shutdown wait of 5 s, the event buffer of 10,000 and the reconnect backoff are constants in their modules. They are runner behavior, not deployment settings.
- **D18. Left out.** Hosted runners, the Codex adapter, npm publishing, feature-scoped worktrees, the run timeline, cost and skills columns, OpenAPI generation, and any admin view of other users' runners.
- **Inputs.** Base commit `396ffcb11b7cb1f66997af6406d9d09c51842303` on `main`. No context files: exploration ran in a subagent and its findings are folded into this plan.

## Constraints

| Constraint | Target | Check |
| --- | --- | --- |
| C1. Runner token and pairing code secrecy | Stored only as SHA-256 hashes, never logged, never in a URL, returned once | Integration tests on stored rows and a log capture test |
| C2. Vendor login rule | No `PLANGINEER_*` variable or runner token reaches the agent child, and no code reads a CLI's credential files | `childEnv` unit test and review against `auth-and-access` |
| C3. Bounded agent output | Each agent string at most 65,536 characters, each socket message at most 1 MiB, each runner buffer at most 10,000 events | Schema tests, a socket test with an oversized message, and a buffer test |
| C4. Cross-platform runner | Runner tests pass on Windows, macOS and Linux in CI | `pnpm verify` in the CI matrix |

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. Schemas accept valid and reject invalid values | ✓ | | | | | |
| 1b. Outputs strip unknown keys, no hash fields | ✓ | | | | | |
| 1c. `run.event` rejects API-only types | ✓ | | | | | |
| 2a. `nextRunStatus` over every pair | ✓ | | | | | |
| 2b. `leaseLostOutcome` combinations | ✓ | | | | | |
| 3a. Migration applies from empty | | ✓ | | | | |
| 3b. Database constraints reject bad rows | | ✓ | | | | |
| 3c. User delete cascades | | ✓ | | | | |
| 4a. API refuses bad timing variables | ✓ | | | | | |
| 4b. Listener receives and reconnects | | ✓ | | | | |
| 5a. `run.create` queues and rejects | | ✓ | | | | |
| 5b. Concurrent claims respect the limit | | ✓ | | | | |
| 5c. No claim for offline, revoked or limited runners | | ✓ | | | | |
| 5d. Lease loss requeues or fails | | ✓ | | | | |
| 5e. Cancel before and after claim, and on terminal | | ✓ | | | | |
| 5f. Lease loss after cancel ends cancelled | | ✓ | | | | |
| 5g. Duplicate runner sequence, consecutive ids | | ✓ | | | | |
| 5h. Rejected transition fails the run | | ✓ | | | | |
| 6a. Pairing issues a hashed token once | | ✓ | | | | |
| 6b. Used, expired and unknown codes rejected | | ✓ | | | | |
| 6c. Pairing code rate limit | | ✓ | | | | |
| 6d. `runner.list` scope, paging, online | | ✓ | | | | |
| 6e. Revoke cancels queued runs, hides others' runners | | ✓ | | | | |
| 6f. Session required except `pair` | | ✓ | | | | |
| 7a. Hello, welcome and assign | | ✓ | | | | |
| 7b. Bad token 401, revoke closes 4001 | | ✓ | | | | |
| 7c. Second socket replaces the first | | ✓ | | | | |
| 7d. Malformed message closes 1008 | | ✓ | | | | |
| 7e. Stale attempt ignored, event acknowledged | | ✓ | | | | |
| 7f. Heartbeat extends lease, reports cancel | | ✓ | | | | |
| 7g. Cancel reaches a socket on another app instance | | ✓ | | | | |
| 7h. Welcome reports acks and validity | | ✓ | | | | |
| 8a. SSE resume with no gap or repeat | | ✓ | | | | |
| 8b. Two streams, one read | | ✓ | | | | |
| 8c. Stream ends after terminal event | | ✓ | | | | |
| 8d. SSE 401, 404 and 400 | | ✓ | | | | |
| 9a. Skills commands keep the old behavior | | ✓ | | | | |
| 9b. Root scripts, verify and hook use the runner | | ✓ | | | ✓ | |
| 10a. Runner rejects bad variables | ✓ | | | | | |
| 10b. `pair` stores credentials or exits 1 | | ✓ | | | | |
| 11a. Fixtures map to events, one terminal | ✓ | | | | | |
| 11b. `detect` versions | | ✓ | | | | |
| 11c. `childEnv` allowlist | ✓ | | | | | |
| 11d. Abort stops the process group | | ✓ | | | | |
| 11e. Windows `taskkill` arguments | ✓ | | | | | |
| 12a. Worktree at the ref, clone reused | | ✓ | | | | |
| 12b. Parallel prepares on one repository | | ✓ | | | | |
| 12c. Unknown ref fails, removal is clean | | ✓ | | | | |
| 13a. Assigned run streams to `run.succeeded` | | ✓ | | ✓ | | |
| 13b. Concurrency limit holds the second run | | ✓ | | | | |
| 13c. Cancel stops the fake agent | | ✓ | | ✓ | | |
| 13d. Reconnect resends above the ack | | ✓ | | | | |
| 13e. Skills drift fails the run | | ✓ | | | | |
| 13f. Plan limit pauses the queue | | ✓ | | | | |
| 13g. `4001` stops `start` | | ✓ | | | | |
| 13h. `SIGINT` stops jobs and children | | ✓ | | | | |
| 14a. Hook keys and invalidation | | | ✓ | | | |
| 14b. `useRunEvents` resume, split chunk, CRLF | | | ✓ | | | |
| 14c. `useRunEvents` 404 and terminal | | | ✓ | | | |
| 15a. Runners pairing and revoke | | | ✓ | ✓ | | |
| 15b. Runs form validation and submit | | | ✓ | ✓ | | |
| 15c. Run page events, notices, cancel | | | ✓ | ✓ | | |
| 15d. Loading, empty, failed and stale states | | | ✓ | | ✓ | |
| 15e. Phone and desktop layouts | | | | | ✓ | |
| 16a. Journeys pass in both projects | | | | ✓ | | |
| 16b. `pnpm runner:fake` serves a run | | | | | ✓ | |
| C1. Token and code secrecy | | ✓ | | | | |
| C2. Vendor login rule | ✓ | | | | | |
| C3. Bounded agent output | ✓ | ✓ | | | | |
| C4. Runner tests on three systems | | ✓ | | | | |

Unit tests cover the contracts, the domain rules, the API environment, the runner environment, the Claude mapping over the recorded and synthetic fixtures, `childEnv` and the `taskkill` arguments. Integration tests in `apps/api` run on Postgres template databases through `createTestDatabase`, with the oRPC router called through `call` and the WebSocket and SSE routes served on port 0 by a real `serve` with a `ws` client. Runner integration tests run the fake agent as a real child process, use local bare repositories made in `fs.mkdtemp` folders with `file:` base URLs, and talk to the test control plane from step 13 instead of the API. Component tests use MSW, as `account-summary.test.tsx` does, with a streamed SSE body for `useRunEvents`. The end-to-end journey uses the e2e session from step 16, the fake agent and a local bare repository. No test calls a real model or GitHub.

## Verification

**Automated**

- `pnpm verify` on Windows, macOS and Linux in CI.
- `pnpm test:e2e` on the local stack.

**Agent checks**

- The implementing agent records `success-tools.jsonl` from `claude -p --output-format stream-json --verbose --permission-mode plan --permission-prompts none` with the prompt "List the files in this folder and name one." in a scratch folder, and `agent-error.jsonl` from the same command with `--model not-a-model`, then scrubs paths, user names and session ids. If the invalid model does not produce an `is_error` result line, the agent records what it does produce and reports it before the mapping for that case is built.
- `pnpm skills:check` and a commit through lefthook run the runner's command (9b).
- With `pnpm dev` and `pnpm runner:fake`, `playwright-cli` screenshots of Runners, Runs and a finished Run page at 1280 px and 375 px, plus the empty, failed and stale states, checked for horizontal scroll, clipped text and targets under 44 px (15d, 15e, 16b).

**Human checks**

- The engineer pairs a runner on Windows with `pnpm runner pair`, starts it with `pnpm runner start`, and runs one test run with their own `claude` login against a real GitHub repository, seeing events stream to Succeeded.
- When someone has a macOS or Linux machine, the same real run there. These do not block the chunk (D14).

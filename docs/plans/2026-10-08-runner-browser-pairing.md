# Runner browser pairing

Oct 8, 2026

## Goal

An engineer pairs a runner with one command and one click: `plangineer-runner login --server <url>` opens the browser at an approval page, the engineer clicks **Approve**, and the terminal finishes by itself. The flow replaces the copy-a-code pairing at `f9246ae` outright. Hosted runners and pairing more than one machine at once are left out.

## Steps

### 1. Contracts

**Files:** `packages/contracts/src/runner.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/runner.test.ts`

Delete `runnerCreatePairingCode`, `runnerPair`, `RunnerCreatePairingCodeOutput`, `RunnerPairInput`, `RunnerPairOutput` and `PAIRING_CODE_PATTERN`. Add these shapes, and the procedures below as `runner.startLogin`, `runner.pollLogin`, `runner.getLogin`, `runner.approveLogin` and `runner.denyLogin`:

| Name | Shape |
| --- | --- |
| `RunnerLoginStatus` | `z.enum(['pending', 'approved', 'denied', 'completed'])` |
| `RunnerUserCode` | `z.string().regex(/^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/)`: 12 Crockford base32 characters, the dashes optional (D2) |
| `RunnerStartLoginInput` | `z.strictObject({ name: z.string().min(1).max(100), platform: RunnerPlatform })` |
| `RunnerStartLoginOutput` | `z.object({ deviceSecret: z.string(), userCode: z.string(), approveUrl: z.url(), expiresAt: z.iso.datetime(), pollIntervalMs: z.int() })` |
| `RunnerPollLoginInput` | `z.strictObject({ deviceSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })`: 32 random bytes as base64url |
| `RunnerPollLoginOutput` | `z.discriminatedUnion('status', [{ status: 'pending' }, { status: 'approved', runnerId: z.uuid(), token: z.string() }, { status: 'denied' }, { status: 'expired' }])` |
| `RunnerUserCodeInput` | `z.strictObject({ userCode: RunnerUserCode })` |
| `RunnerLogin` | `z.object({ name: z.string(), platform: RunnerPlatform, status: RunnerLoginStatus.exclude(['completed']), requestedAt: z.iso.datetime(), expiresAt: z.iso.datetime() })` |

| Procedure | Who | Input | Output | Errors |
| --- | --- | --- | --- | --- |
| `runner.startLogin` | public | `RunnerStartLoginInput` | `RunnerStartLoginOutput` | `TOO_MANY_REQUESTS` (429) |
| `runner.pollLogin` | public | `RunnerPollLoginInput` | `RunnerPollLoginOutput` | none |
| `runner.getLogin` | member | `RunnerUserCodeInput` | `RunnerLogin` | `NOT_FOUND` |
| `runner.approveLogin` | member | `RunnerUserCodeInput` | `RunnerLogin` | `NOT_FOUND`, `CONFLICT` |
| `runner.denyLogin` | member | `RunnerUserCodeInput` | `RunnerLogin` | `NOT_FOUND`, `CONFLICT` |

`pollLogin` answers `expired` for an unknown, expired or already completed login request alike. The answer reveals nothing about secrets the caller does not hold (D4). `RunnerLogin` reports a `completed` login request as `approved` (D9).

**Done when:**

- 1a. Each new input schema accepts a valid value and rejects a malformed user code, a 42-character device secret, an unknown key and a name of 101 characters.
- 1b. Each new output schema strips an unknown key, `RunnerPollLoginOutput` parses each of its four statuses, and `RunnerLogin` rejects the status `completed`.

### 2. Table

**Files:** `apps/api/src/db/schema.ts`, `apps/api/drizzle/0003_*.sql`, `apps/api/drizzle/meta/*` (generated), `apps/api/src/db/schema.test.ts`

Drop `runner_pairing_codes` and add `runner_logins`. Its status enum is `pgEnum('runner_login_status', RunnerLoginStatus.enum)`, built from the contracts enum as `schema.ts` builds the others:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | `uuidv7()` |
| `device_secret_hash` | `text` | not null, unique |
| `user_code_hash` | `text` | not null, unique |
| `name` | `text` | not null, 1 to 100 characters by `check` |
| `platform` | `runner_platform` | not null |
| `status` | `runner_login_status` | not null, default `pending` |
| `user_id` | `uuid` | references `user`, `onDelete: 'cascade'`, indexed. Set by approve |
| `runner_id` | `uuid` | references `runners`, `onDelete: 'cascade'`, unique. Set by the completing poll |
| `expires_at` | `timestamptz` | not null |
| `created_at` | `timestamptz` | |

Checks: `(user_id IS NOT NULL) = (status IN ('approved', 'completed'))` and `(runner_id IS NOT NULL) = (status = 'completed')`. A plain index on `expires_at` serves both the pending count and the cleanup delete in step 3. Generate the migration with `pnpm --filter @plangineer/api db:generate` and prove it with `pnpm db:reset`.

**Done when:**

- 2a. The migration applies from empty with `pnpm db:reset`.
- 2b. Each check and unique constraint rejects a breaking row, and deleting a user deletes the login requests they approved.

### 3. API

**Files:** `apps/api/src/runners/pairing.ts`, `apps/api/src/runners/runner-login-service.ts`, `apps/api/src/runners/runner-login-repository.ts`, `apps/api/src/runners/runner-service.ts`, `apps/api/src/runners/runner-repository.ts`, `apps/api/src/runners/runner-socket-lifecycle.test.ts`, `apps/api/src/rpc/router.ts`, `apps/api/src/env.ts`, `apps/api/src/logger.ts`, `apps/api/src/test/fixtures.ts`, `.env.example`, tests beside each

- `RUNNER_PAIRING_CODE_TTL_MS` becomes `RUNNER_LOGIN_TTL_MS`, from 60,000 to 3,600,000, default 600,000 in `.env.example`. A local `.env` written before this change fails `parseEnv` with the key's name until the engineer renames that line.
- `generatePairingCode` becomes `generateUserCode`. It keeps the 12 Crockford base32 characters from `randomInt`, shown as `XXXX-XXXX-XXXX`.
- `generateDeviceSecret` returns 32 bytes from `randomBytes` as base64url.
- `normalizePairingCode` becomes `normalizeUserCode`: dashes removed, uppercased.
- The API stores the user code only as `hashSecret(normalizeUserCode(userCode))`, and the device secret only as `hashSecret(deviceSecret)`, unchanged.
- **`startLogin`.** One transaction runs under `pg_advisory_xact_lock(hashtextextended('runner-logins', 0))`:
  1. It deletes login requests whose `expires_at` passed more than an hour ago.
  2. It refuses with `TOO_MANY_REQUESTS` when 200 pending login requests are unexpired.
  3. It inserts the login request with `expires_at = now() + RUNNER_LOGIN_TTL_MS`.

  It returns `approveUrl` as `${BETTER_AUTH_URL}/runners/approve?code=<userCode>`, and `pollIntervalMs` of 2,000 (D5).
- **`getLogin`, `approveLogin` and `denyLogin`.** Each finds the login request by `hashSecret(normalizeUserCode(userCode))`. A missing or expired login request is `NOT_FOUND`. `getLogin` returns a `completed` login request as `approved` (D9). Approve and deny lock the row and need `status = 'pending'`, else `CONFLICT`. Approve sets `approved` with the caller's `user_id`. Deny sets `denied`.
- **`pollLogin`.** In one transaction, it selects the login request by the device secret's hash `FOR UPDATE`, then answers by status. Two overlapping polls therefore complete a login request once:

  | Status | Answer |
  | --- | --- |
  | `pending` or `denied`, unexpired | Returned as it is |
  | `approved`, expired or not | Completes in the same transaction: generates a runner token, inserts the runner through `insertRunner` with the login request's name, platform and `user_id`, sets `completed` and `runner_id`, and returns `{ status: 'approved', runnerId, token }`. This is the only time the token leaves the API |
  | Anything else | `expired` |

  An approved login request completes whatever its `expires_at`, because the approval itself came in time.
- Delete `createPairingCode`, `pairRunner`, the pairing code queries, `PAIRING_CODE_LIMIT` and `PAIRING_CODE_WINDOW_MS`.
- The router builds `startLogin` and `pollLogin` from `os` with a comment that they are public, and the other three from `authed`.
- `logger.ts` adds `*.deviceSecret` and `*.userCode` to `redact.paths`.
- `runner-socket-lifecycle.test.ts` pairs through start, approve and poll before it connects, in place of `runner/createPairingCode` and `runner/pair`.

**Done when:**

- 3a. Start, approve, then poll returns the token once, stores only its hash on a new runner owned by the approver, and a second poll returns `expired`.
- 3b. Polling a pending login request returns `pending`, a denied one `denied`, and an expired, unknown or completed one `expired`.
- 3c. Approving or denying an expired or unknown user code returns `NOT_FOUND`, and approving a denied or completed login request returns `CONFLICT`.
- 3d. With 200 pending login requests unexpired, `startLogin` returns `TOO_MANY_REQUESTS`, and a start deletes login requests that expired more than an hour ago.
- 3e. A user code without its dashes or in lower case finds the same login request.
- 3f. `getLogin`, `approveLogin` and `denyLogin` refuse a caller with no session. In `runner-socket-lifecycle.test.ts`, no log line from pairing and connecting holds the device secret, the user code with or without its dashes, or the runner token.
- 3g. A login request approved before its `expires_at` and polled after it still returns the token.
- 3h. `getLogin` returns a completed login request with the status `approved`.
- 3i. Two concurrent polls of an approved login request return one token and create one runner, and the other poll returns `expired`.

### 4. Runner `login` command

**Files:** `apps/runner/src/login-command.ts`, `apps/runner/src/login-command.test.ts`, `apps/runner/src/pair-command.ts` (deleted), `apps/runner/src/pair-command.test.ts` (deleted), `apps/runner/src/cli.ts`, `apps/runner/src/cli.test.ts`, `apps/runner/src/start-command.ts`, `apps/runner/src/start-command-connection.test.ts`, `apps/runner/src/config/runner-logger.ts`, `apps/runner/src/config/runner-logger.test.ts`, `apps/runner/package.json`, `pnpm-lock.yaml`, `apps/runner/README.md`

Add `open` 11.0.4 to the runner's dependencies. `login-command` takes the opener as a dependency, so tests can pass one that fails. `plangineer-runner login --server <url> [--name <name>] [--no-browser]` replaces `pair`:

1. The command calls `runner.startLogin` with the name and the platform. The name defaults to the host name.
2. It prints `To pair this machine, approve it in Plangineer: <approveUrl>` and `Code: <userCode>`. Then it opens `approveUrl` with `open`, unless `--no-browser` is set. `open` rejects its promise when no browser can be launched. The command catches that rejection, leaves the printed link and keeps polling, with no error.
3. It polls `runner.pollLogin` every `pollIntervalMs` and acts on each answer:

| Answer | Result |
| --- | --- |
| `approved` | Writes `runner.json` with `writeCredentials` and prints `Paired as <name>. Start the runner with plangineer-runner start.` |
| `denied` | Fails with `The pairing was denied in Plangineer.` |
| `expired` | Fails with `The pairing request expired. Run plangineer-runner login again.` |
| `TOO_MANY_REQUESTS` from `startLogin` | Fails with `Too many pairing requests are waiting in Plangineer. Try again in a few minutes.` |
| A network error | Fails at once with its message |

`start` without credentials says `This runner is not paired. Run plangineer-runner login --server <url> first.` A revoked or unknown token says `This runner was revoked or its token is invalid. Pair it again with plangineer-runner login.` The runner logger replaces its `code` and `*.code` redaction, which only pairing codes needed, with `deviceSecret`, `*.deviceSecret`, `userCode` and `*.userCode`. WebSocket close codes and error codes such as `ECONNREFUSED` then show in the log again. The package version becomes `0.2.0` (D8).

**Done when:**

- 4a. Against a fake control plane, `login --no-browser` prints the link and user code, polls through `pending` to `approved`, writes `runner.json` and exits 0.
- 4b. A denied request, an expired request and a `TOO_MANY_REQUESTS` start each exit 1 with their message and write no `runner.json`.
- 4c. `login` without `--server`, or with a server that is not a URL, prints the usage, and `pair` is no longer a command.
- 4d. The runner logger redacts `deviceSecret`, `userCode` and `token`, and logs `code` as it is.
- 4e. A network error from `startLogin` or `pollLogin` exits 1 with its message and writes no `runner.json`.
- 4f. With an opener that rejects, `login` prints the link, polls to `approved` and exits 0.

### 5. Client hooks

**Files:** `packages/api-client/src/runners.ts`, `packages/api-client/src/index.ts`, `packages/api-client/src/runners.test.tsx`

Delete `useCreatePairingCode`. Add `useRunnerLogin(userCode: string | undefined)` over `runner.getLogin`, which passes `skipToken` when `userCode` is undefined. Add `useApproveRunnerLogin` and `useDenyRunnerLogin`, which write the returned login request to the `getLogin` cache. Neither invalidates `runner.list`, because the runner exists only after the terminal's next poll. The Runners screen refetches its list when it mounts.

**Done when:**

- 5a. Approving updates the cached login request to `approved`, and denying updates it to `denied`.

### 6. Sign-in return path

**Files:** `apps/web/src/lib/safe-return-path.ts`, `apps/web/src/lib/safe-return-path.test.ts`, `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/sign-in.tsx`, `apps/web/src/features/auth/sign-in-card.tsx`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/route-tree.test.tsx`, `apps/web/src/features/auth/sign-in-card.test.tsx`, `apps/web/e2e/sign-in.spec.ts`, `apps/api/src/app.test.ts`

A signed-out visitor to any `_app` page returns to it after sign-in (D6).

- `_app` redirects to `/sign-in?redirect=<path and search>`.
- `safeReturnPath(value: string, origin: string): string` returns `value` when it is a same-origin path, and `/` otherwise. A same-origin path starts with `/`, holds no backslash and no control character, and satisfies `new URL(value, origin).origin === origin`.
- `sign-in.tsx` validates `redirect` in `validateSearch` as `z.string().default('/').transform((value) => safeReturnPath(value, window.location.origin)).catch('/')`. The key is optional on input and always a string on output, as the `error` parameter is optional. So `navigate({ to: '/sign-in' })` in `account-summary.tsx` keeps compiling, and sign-out lands on `/sign-in` with no `redirect`. A signed-in visitor to `/sign-in` goes to `redirect` with `redirect({ href })`.
- `signInWithGitHub(redirect)` passes the path as Better Auth's `callbackURL`. It passes `/sign-in?redirect=<encoded path>` as `errorCallbackURL`, so a failed sign-in keeps the return path.
- Better Auth 1.7.7 accepts a root-relative `callbackURL` and `errorCallbackURL` with a query string. `isSafeRelativeURL` in `dist/auth/trusted-origins.mjs` allows them, and `dist/api/middlewares/origin-check.mjs` allows relative paths for every label but `origin`. 6c keeps that behavior under test.
- `sign-in.spec.ts` expects `/sign-in?redirect=%2F` after a signed-out visit to `/`.

**Done when:**

- 6a. A signed-out visit to `/runners/approve?code=ABCD-EFGH-JKMN` lands on `/sign-in` with that path in `redirect`. Sign-in starts with it as the callback URL and with `/sign-in?redirect=<that path>` as the error callback URL.
- 6b. `safeReturnPath` returns `/` for `https://example.com`, `//example.com`, `/\example.com`, `/a\b`, a path holding a tab or a newline, and an empty string, and returns `/runners/approve?code=ABCD-EFGH-JKMN` unchanged.
- 6c. Better Auth's `POST /api/auth/sign-in/social` accepts a `callbackURL` of `/runners/approve?code=ABCD-EFGH-JKMN` and refuses `https://example.com`.
- 6d. A signed-in visit to `/sign-in?redirect=//example.com` lands on `/`.

### 7. Approval page and Runners card

**Files:** `apps/web/src/routes/_app/runners.tsx` (moved to `apps/web/src/routes/_app/runners/index.tsx`), `apps/web/src/routes/_app/runners/approve.tsx`, `apps/web/src/features/runners/approve-runner-screen.tsx`, `apps/web/src/features/runners/add-runner-card.tsx`, `apps/web/src/features/runners/pair-runner-card.tsx` (deleted), `apps/web/src/features/runners/runner-list.tsx`, `apps/web/src/features/runners/runners-screen.tsx`, component tests beside each, `apps/web/src/routeTree.gen.ts` (regenerated by the router plugin)

The Runners route moves to `routes/_app/runners/index.tsx` as `createFileRoute('/_app/runners/')`, as `runs/index.tsx` is set up. A flat `runners.tsx` would make `/runners/approve` its child, and `RunnersScreen` renders no `<Outlet />`.

**Approval page (`/runners/approve?code=`).**

- The route validates its search with `z.object({ code: RunnerUserCode.optional().catch(undefined) })` and passes `code` to `useRunnerLogin`.
- The page renders from the loaded status, so a reload or a refetch on focus shows the same state:

| State | Shows |
| --- | --- |
| Loading | `Skeleton` in the card's shape |
| Failed load | `LoadFailed`, its `Alert` with **Retry** |
| Stale (a refetch failed with content shown) | `StaleNotice` above the card |
| `pending` | A card titled **Pair &lt;name&gt;?** with the platform, the request time and the user code. Below them: "Approve only if you just ran `plangineer-runner login` and your terminal shows this code." **Approve** is the default `Button` and **Deny** the outline one |
| `approved` | A `CircleCheck` icon in `text-success` and "Approved. Your terminal finishes pairing on its own.", with a link to Runners |
| `denied` | A `CircleX` icon in `text-muted-foreground` and "Denied. Nothing was paired." |
| `NOT_FOUND`, or no `code` | "This pairing request expired or was already used. Run `plangineer-runner login` again." with no buttons |

- The user code uses `font-mono text-2xl tracking-widest`. The machine name wraps with `break-all`, since it holds up to 100 characters.
- A failed approve or deny acts on its error code:

  | Error | Result |
  | --- | --- |
  | `NOT_FOUND` | The page shows the expired state, as a reload would |
  | `CONFLICT` | "This request was already decided. Reload to see its state." under the button, with both buttons enabled |
  | Any other | "Could not reach Plangineer. Try again." under the button, with both buttons enabled |
- On a phone, the card fills the width and the buttons stack full width at 44 px tall or more. From `md:` the card is `max-w-md`, centered, with the buttons side by side.

**Runners card.** **Add a runner** replaces the pairing card. It shows `npx plangineer-runner login --server <window.location.origin>` with a `CopyButton`, and one line: "Run it on the machine, then approve the request it opens in your browser." It makes no API call (D8). The empty state in `runner-list.tsx` reads "Pair your first runner with the Add a runner card above."

**Done when:**

- 7a. The approval page shows the login request's name, platform and user code, and **Approve** sends `approveLogin` and shows the approved state.
- 7b. **Deny** shows the denied state, and an unknown or expired user code shows the expired message with no buttons.
- 7c. The Runners screen shows the `npx plangineer-runner login --server` command for the current origin, and its empty state names the Add a runner card.
- 7d. Screenshots at desktop and 375 px show the approval page in each state with no overflow.
- 7e. The approval page shows a skeleton while loading, and a failed load shows **Retry**, which loads the login request again.
- 7f. A `CONFLICT` from **Approve** shows its message under **Approve**, and a network failure of **Deny** shows its message under **Deny**, each with both buttons enabled.
- 7i. A `NOT_FOUND` from **Approve** or **Deny** shows the expired state with no buttons.
- 7g. `/runners/approve` with no `code` or a malformed one shows the expired message and sends no request.
- 7h. A login request loaded as `approved` shows the approved state on a fresh load of the page.

### 8. Journey and docs

**Files:** `apps/web/e2e/runner-test-run.spec.ts`, `.agents/skills/auth-and-access/SKILL.md`, `.agents/skills/runner-adapters/SKILL.md`, `.agents/skills/data-model-design/SKILL.md`, `.agents/skills/security/SKILL.md`, `docs/engineering/stack-decisions.md`, `docs/plans/mvp-roadmap.md`

- **Journey.** The journey starts `node apps/runner/src/cli.ts login --server <web origin> --name <runnerName> --no-browser` with execa and the same `env` as at `f9246ae`: `PLANGINEER_RUNNER_DATA_DIR`, `PLANGINEER_GIT_BASE_URL` and `PLANGINEER_CLAUDE_COMMAND`. It does not await the process. It reads the approval link from the process's stdout stream, opens it in the signed-in page and clicks **Approve**. Then it awaits exit 0 before the test run it already makes.
- **`auth-and-access`.** "Runner pairing" describes this flow: a public start that returns a device secret and a user code, approval by a signed-in member, and a poll that returns the token once. The rules below change:

| Line at `f9246ae` | New wording |
| --- | --- |
| Property 1, "bound to that user" | The runner login request is bound to the member who approves it. It expires in minutes and is stored only as hashes |
| "Pairing codes and tokens are never logged, put in a URL query string or returned a second time" | Device secrets and tokens are never logged, put in a URL or returned a second time. The user code may appear in the approval link, since it grants nothing without a signed-in approval (D3). None of the three is logged |
| "Pairing procedures are rate-limited per user" | The public login procedures are bounded by a global cap on pending login requests (D4). The user code has 60 bits, so the member procedures need no per-user limit |
| Tests: "a pairing code used twice, an expired code" | A login request polled twice, an expired login request, and an approved login request polled after expiry |
| Review row: "stored in plaintext, logged, placed in a URL, or returned more than once" | A device secret or token placed in a URL, or any of the three stored in plaintext, logged, or returned more than once |
| Review row: "A pairing code that does not expire, is reusable, or is not bound to a user" | A login request that does not expire, completes twice, or issues a token before a signed-in member approves it |

- **`security`.** The "Webhooks" row adds `runner.startLogin` and `runner.pollLogin` as the other unauthenticated writes, bounded by D4. The `redact.paths` and test-coverage lines name device secrets, user codes and an expired login request in place of pairing codes.
- **`data-model-design`.** The "Runner pairing code" record becomes "Runner login request": belongs to no user until approved, then to the approver and cascades with them. Its secrets are stored only as hashes. It completes once, and it is deleted an hour after it expires.
- **Other docs.** `runner-adapters` names `plangineer-runner login`. The `stack-decisions` row for `pnpm runner` becomes `pnpm runner login --server <url>`, then `pnpm runner start`. The roadmap records the change.
- Run `pnpm skills:sync` and `pnpm skills:lint` after the skill edits.

**Done when:**

- 8a. `pnpm test:e2e` pairs a runner through the approval page and completes the test run.
- 8b. `pnpm skills:lint` passes. A case-insensitive search for `pnpm runner pair`, `plangineer-runner pair` and `pairing code` finds nothing in `.agents/skills/`, `docs/engineering/`, `apps/runner/README.md`, `apps/` source or `packages/` source.

## Decisions

All decisions were made on Oct 8, 2026. The engineer asked for pairing to be as smooth as possible. The planner made D1 to D8, and the engineer chose D9 and the review changes to D2, D4 and D8 in plan review. The engineer can overrule any of them.

- **D1. A device authorization flow, after RFC 8628.** The terminal starts a login request and polls, and the browser, signed in, approves it. `gh auth login` and `claude` use the same pattern. No secret crosses from the browser to the terminal by hand.
- **D2. One click, with the user code shown on both sides.** The approval link carries the user code, as RFC 8628's `verification_uri_complete` does, so the engineer types nothing. The page and the terminal both show the user code. The page says to approve only a login request just made, which is the defense against a phished link. The user code keeps the 12 characters (60 bits) of the pairing code at `f9246ae`. Nobody types it, so the length costs nothing, and guessing another engineer's pending code stays out of reach without a per-user limit. Rejected: making the engineer type the user code, which `gh` does and which costs a step.
- **D3. The user code may sit in a URL.** The user code identifies a login request and grants nothing: pairing needs a signed-in member's approval. The device secret, which the poll trades for the token, never leaves the runner's memory. Step 8 amends the `auth-and-access` rule that pairing codes never go in a query string.
- **D4. Public endpoints are bounded globally.** The procedure context carries no client IP. So `startLogin` refuses at 200 unexpired pending login requests, and each start deletes expired rows. `pollLogin` only reads by hash and answers one `expired` for every unknown case. An unauthenticated client can therefore keep every engineer's `login` at `TOO_MANY_REQUESTS` until its own login requests expire. The engineer accepts that risk: the lockout grants no access, a deployment serves one team, and the runner names the cause (step 4). Rejected: an IP rate limiter, which needs proxy-aware IP handling the API lacks.
- **D5. A fixed 2-second poll.** The approval step takes seconds, and 2 seconds keeps the terminal responsive. The interval comes from the server, so it can change without a runner release.
- **D6. Sign-in keeps the page the engineer asked for.** A signed-out engineer who opens the approval link signs in and lands back on it. The return path applies to every `_app` page. It must be same-origin, so the sign-in page cannot be used as an open redirect.
- **D7. The old pairing is deleted.** The prototype keeps one way to pair. `pair`, the pairing code procedures, their table and `useCreatePairingCode` go in this change. Runners already paired keep their tokens.
- **D8. The runner moves to 0.2.0.** The published 0.1.0 has `pair` and no `login`, so the engineer publishes 0.2.0 after this change merges. Until then, the Runners card's `npx plangineer-runner login` fails, and engineers on a checkout use `pnpm runner login --server <url>`. Setup pull requests made before then keep working, since `skills check` is unchanged.
- **D9. A completed login request shows as approved.** The terminal's poll moves an approved login request to `completed` about 2 seconds after the click. `getLogin` reports it as `approved`, so the approval page keeps its approved state after a reload or a refetch on focus. Rejected: a separate `completed` status, which adds copy for no decision, and `NOT_FOUND`, which turns the page from Approved to Expired within seconds.
- **Left out.** Pairing several machines from one approval, pairing from the web without a terminal, and hosted runners (chunk 8).
- **Inputs.** Base commit `f9246ae9a652739f004ed36b09d7f6f578fb8e24` on `main`. The exploration ran in this planning session and its findings are folded into this plan.

## Constraints

| Constraint | Target | Check |
| --- | --- | --- |
| C1. Pairing secrets stay secret | The device secret and runner token never appear in a URL, log, error or response other than the one completing poll | 3a, 3f, 4d |
| C2. Bounded public endpoints | At most 200 unexpired pending login requests, and no expired row older than an hour after a start | 3d |
| C3. No open redirect | The sign-in return path is always a same-origin path | 6b, 6c, 6d |

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. Input schemas accept and reject | ✓ | | | | | |
| 1b. Output schemas strip and parse | ✓ | | | | | |
| 2a. Migration applies from empty | | ✓ | | | | |
| 2b. Constraints and cascade | | ✓ | | | | |
| 3a. Start, approve, poll once | | ✓ | | | | |
| 3b. Poll statuses | | ✓ | | | | |
| 3c. Approve and deny errors | | ✓ | | | | |
| 3d. Pending cap and cleanup | | ✓ | | | | |
| 3e. User code normalization | | ✓ | | | | |
| 3f. Auth and no secrets in logs | | ✓ | | | | |
| 3g. Approved login completes after expiry | | ✓ | | | | |
| 3h. Completed reads as approved | | ✓ | | | | |
| 3i. Concurrent polls complete once | | ✓ | | | | |
| 4a. Login succeeds | | ✓ | | | | |
| 4b. Denied, expired and too many | | ✓ | | | | |
| 4c. Usage and no `pair` | ✓ | | | | | |
| 4d. Runner logger redaction | ✓ | | | | | |
| 4e. Network error | | ✓ | | | | |
| 4f. Browser fails to open | | ✓ | | | | |
| 5a. Hooks update the cache | | | ✓ | | | |
| 6a. Return path kept | | | ✓ | | | |
| 6b. Unsafe return paths refused | ✓ | | | | | |
| 6c. Better Auth accepts the callback path | | ✓ | | | | |
| 6d. Signed-in redirect stays same-origin | | | ✓ | | | |
| 7a. Approve | | | ✓ | | | |
| 7b. Deny and expired | | | ✓ | | | |
| 7c. Runners card command | | | ✓ | | | |
| 7d. Screenshots | | | | | ✓ | |
| 7e. Loading and failed load | | | ✓ | | | |
| 7f. Approve conflict and failed deny | | | ✓ | | | |
| 7g. Missing or malformed code | | | ✓ | | | |
| 7h. Fresh load of an approved login request | | | ✓ | | | |
| 7i. Approve or deny after expiry | | | ✓ | | | |
| 8a. Journey pairs through approval | | | | ✓ | | |
| 8b. Skills lint and no old terms | | | | | ✓ | |
| C1. Secrets stay secret | ✓ | ✓ | | | | |
| C2. Bounded public endpoints | | ✓ | | | | |
| C3. No open redirect | ✓ | ✓ | ✓ | | | |

Unit tests cover the contract schemas, the CLI's argument handling, the runner logger's redaction and `safeReturnPath`. API integration tests call the procedures through the router on real Postgres. They fix the clock only by setting `expires_at` in the past, and capture the pino output for the secret scan. Runner tests use a fake HTTP server speaking the oRPC wire format, as `pair-command.test.ts` does at `f9246ae`. The server answers `startLogin` and a scripted sequence of `pollLogin` replies. The tests use `--no-browser`, except 4f, which passes an opener that rejects. Component tests use Testing Library with MSW for each approval state and the sign-in redirect. The journey uses the e2e session cookie and the real CLI.

## Verification

**Automated**

- `pnpm verify`.
- `pnpm skills:lint`.
- `pnpm test:e2e`, for the pairing journey.

**Agent checks**

- Screenshot `/runners/approve` at desktop and 375 px in its loading, failed, stale, pending, approved, denied and expired states, on the dev stack after `pnpm db:reset` (7d). The agent signs in with the cookie from `pnpm --filter @plangineer/api e2e:session --user seed-member`. It makes login requests with `PLANGINEER_RUNNER_DATA_DIR=<temp dir> pnpm runner login --server http://localhost:5173 --no-browser`, then approves or denies them. It opens an unknown user code for the expired state, and blocks the `getLogin` request for the failed and stale states.
- Run the 8b search and `pnpm skills:lint`.

**Human checks**

- The engineer renames `RUNNER_PAIRING_CODE_TTL_MS` to `RUNNER_LOGIN_TTL_MS` in their local `.env`. Then they run `pnpm runner login --server http://localhost:5173` on Windows with no flags, see the browser open at the approval page, click **Approve**, and see the terminal finish.
- The engineer runs `pnpm runner:publish` after this change merges, then `npx plangineer-runner@0.2.0 --version`.

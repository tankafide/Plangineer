# Desktop app

Oct 8, 2026

## Goal

A person downloads Plangineer from GitHub Releases, opens it on Windows, macOS or Linux, and reaches a paired, online runner without Node, Docker or a terminal. The desktop app is a thin Electron shell around the same API, web app and Postgres a team server runs. Hosted or team deployment, Codex, the mobile app, signed builds and a standalone runner binary are left out (D14).

## Steps

### 1. Bundle-safe logging and asset paths

**Files:** `apps/api/src/logger.ts`, `apps/api/src/logger.test.ts`, `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `apps/api/src/main.ts`, `apps/api/src/db/reset.ts`, `apps/api/src/db/seed-cli.ts`, `apps/api/src/db/migrate-cli.ts`, `apps/api/src/db/migrate-cli.test.ts`, `apps/api/src/package-root.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/setup/setup-files.ts`, `apps/api/src/server.ts`, `apps/api/src/test/fixtures.ts`, `apps/runner/src/config/runner-logger.ts`, `apps/runner/src/config/runner-logger.test.ts`, `.env.example`

The API and runner must run from a single bundled file outside the repository (D4). Three things stop that today: pino worker transports, a log path relative to the source file, and asset paths relative to source files.

- **Loggers.** `createLogger` in the API and the runner logger replace `pino.transport` with `pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: logFile, mkdir: true, sync: false }) }])`. Level, redaction and serializers stay as they are. The API's `createLogger(level, logFile?)` writes to stdout only when no file is given. `main.ts` logs an environment that fails to parse that way, since it has no file yet. The server, `reset.ts` and `seed-cli.ts` pass `env.API_LOG_FILE`. The test global setup keeps its stdout-only `createLogger('warn')`. The runner keeps `<data>/logs/runner.log`.
- **New API variables.** `API_LOG_FILE` is required, `z.string().min(1)`, resolved with `path.resolve(PACKAGE_ROOT, value)`, so the working folder never matters. `.env.example` sets `API_LOG_FILE=../../logs/api.log`, which is `<repo>/logs/api.log` from `apps/api/`. The desktop app passes an absolute path. `API_HOST` is required, `z.string().min(1)`, passed to `serve({ hostname })`. `.env.example` sets `API_HOST=127.0.0.1`.
- **Package root.** `apps/api/src/package-root.ts` exports `PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))`. From source it is `apps/api/`. From the bundle at `<server>/dist/main.mjs` it is `<server>/`. `migrate.ts` uses `path.join(PACKAGE_ROOT, 'drizzle')`. `setup-files.ts` uses `path.join(PACKAGE_ROOT, 'src', 'setup', 'templates')`. No other module resolves a file from `import.meta.url`.
- **Migrate environment.** `migrate-cli.ts` parses its own schema, `z.object({ DATABASE_URL: z.url() })`, and nothing else. Migrating needs only the database, so the migrate bundle runs with `DATABASE_URL` alone.

**Done when:**

- 1a. The API logger writes each line to stdout and to the file `API_LOG_FILE` names, creating its folder, with redaction unchanged.
- 1b. The runner logger writes to stdout and `<data>/logs/runner.log` with no worker thread, and its redaction tests still pass.
- 1c. `parseEnv` rejects a missing `API_LOG_FILE` or `API_HOST` and names the key.
- 1d. The API listens only on the host `API_HOST` names.
- 1e. Migrations and setup templates load through `PACKAGE_ROOT`, and the existing migration and template tests pass.
- 1f. `migrate-cli.ts` migrates an empty database with only `DATABASE_URL` set, and fails naming `DATABASE_URL` when it is missing.
- 1g. A relative `API_LOG_FILE` resolves against `PACKAGE_ROOT` whatever the working folder.

### 2. Builds for the API, web and runner

**Files:** `apps/api/package.json`, `apps/api/tsdown.config.ts`, `apps/web/package.json`, `apps/runner/package.json`, `apps/runner/tsdown.config.ts`, `apps/runner/src/package.test.ts`, `turbo.json`, `package.json`, `pnpm-lock.yaml`, `knip.json`, `.gitignore`, `scripts/setup-env.mjs`, `scripts/smoke-server-bundle.mjs`, `.github/workflows/ci.yml`

- **API.** Add tsdown 0.23.0 and a `build` script. Entries `main: src/main.ts` and `migrate: src/db/migrate-cli.ts`, ESM, `platform: 'node'`, `target: 'node24'`, out to `apps/api/dist/` with `.mjs`. Every dependency is bundled, including the workspace packages, except `pg-native`, which `pg` requires only when installed.
- **Web.** Add a `build` script, `vite build`, out to `apps/web/dist/`.
- **Runner.** The build bundles every dependency, not only `@plangineer/contracts`. The runtime packages move from `dependencies` to `devDependencies`, so the published `plangineer-runner` has no dependencies. Bundled, `open` 11.0.4 finds no local `xdg-open` and uses the system one, as its `index.js` does when its folder has no `xdg-open`. The version stays `0.2.0` until the engineer next publishes. `package.test.ts` builds into a folder under `os.tmpdir()` that holds only `dist/` and `package.json`, so no `node_modules` can resolve a missing dependency.
- **Turborepo.** Add a `build` task with `dependsOn: ["^build"]` and `outputs: ["dist/**"]`. Add a root `build` script, `turbo run build`. `.gitignore` adds `apps/api/dist/`.
- **Smoke.** `scripts/smoke-server-bundle.mjs` copies `apps/api/dist`, `apps/api/drizzle` and `apps/api/src/setup/templates` into a temp folder as `server/dist/`, `server/drizzle/` and `server/src/setup/templates/`, the layout the desktop app ships. It runs `migrate.mjs` with only `DATABASE_URL`, from its own environment. It runs `main.mjs` with the values `pnpm setup:env` writes, through a new export `envValues(exampleText)` in `scripts/setup-env.mjs`, overridden with that `DATABASE_URL`, a free `API_PORT` and an `API_LOG_FILE` in the temp folder. Both run with `process.execPath`. It waits for `GET /api/auth/ok` to answer 200, and stops the server. A CI job `bundle` runs `pnpm build` and the smoke script on all three systems, with Postgres from `ikalnytskyi/action-setup-postgres`.

**Done when:**

- 2a. `pnpm build` writes `apps/api/dist/main.mjs`, `apps/api/dist/migrate.mjs`, `apps/web/dist/index.html` and `apps/runner/dist/cli.mjs`.
- 2b. The smoke script migrates an empty database and gets 200 from `/api/auth/ok`, from a folder outside the repository with no `node_modules`, on Windows, macOS and Linux.
- 2c. `node apps/runner/dist/cli.mjs --version` prints `0.2.0` from a folder with only `dist/` and `package.json`.

### 3. The API serves the web app

**Files:** `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/web-assets.ts`, `apps/api/src/web-assets.test.ts`, `.env.example`

`WEB_DIST_DIR` is an optional absolute path. When it is set, the API serves the built SPA on the same origin as `/api` and `/rpc`. A team server's container sets it too. When it is unset, as in dev, Vite serves the web app and proxies to the API, as today (D5).

- `web-assets.ts` registers `serveStatic({ root: WEB_DIST_DIR })` from `@hono/node-server/serve-static` after every API route. Files under `/assets/` get `Cache-Control: public, max-age=31536000, immutable`.
- A `GET` that matches no file and does not start with `/api/` or `/rpc/` gets `index.html` with `Cache-Control: no-cache`, so TanStack Router handles the path.
- `.env.example` lists `# WEB_DIST_DIR=<absolute path to apps/web/dist; unset in dev, where Vite serves the web app>`.

**Done when:**

- 3a. With `WEB_DIST_DIR` set to a fixture folder, `GET /` and `GET /repositories` return `index.html`, and `GET /assets/app.js` returns the file with the immutable header.
- 3b. `GET /api/unknown` and `GET /rpc/unknown` still answer 404 from the API, never `index.html`.
- 3c. With `WEB_DIST_DIR` unset, `GET /` answers 404.

### 4. GitHub App stored in the database

**Files:** `packages/contracts/src/instance.ts`, `packages/contracts/src/instance.test.ts`, `packages/contracts/src/github-failed.ts`, `packages/contracts/src/repository.ts`, `packages/contracts/src/index.ts`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/0004_*.sql`, `apps/api/drizzle/meta/*` (generated), `apps/api/src/db/schema.test.ts`, `apps/api/src/github/github-app-store.ts`, `apps/api/src/github/github-app-store.test.ts`, `apps/api/src/github/github-app-manifest.ts`, `apps/api/src/github/github-app-manifest.test.ts`, `apps/api/src/github/github-app-conversion.ts`, `apps/api/src/github/github-app-conversion.test.ts`, `apps/api/src/github/github.ts`, `apps/api/src/github/github.test.ts`, `apps/api/src/lib/service-deps.ts`, `apps/api/src/auth/auth-cli.ts`, `apps/api/src/auth/session.ts`, `apps/api/src/runs/run-event-stream.ts`, `apps/api/src/test/test-app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/test/global-setup.ts`, `apps/api/src/test/e2e-session-cli.ts`, `scripts/env-file.test.mjs`, `scripts/test-e2e.mjs`, `apps/api/src/instance/instance-service.ts`, `apps/api/src/instance/instance-service.test.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/auth/auth.test.ts`, `apps/api/src/auth/auth-provider.ts`, `apps/api/src/auth/auth-provider.test.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/rpc/router.ts`, `apps/api/src/logger.ts`, `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `apps/api/src/repositories/repository-service.ts`, `apps/api/src/db/reset.ts`, `apps/api/src/db/reset.test.ts`, `apps/api/src/test/fixtures.ts`, `apps/api/src/test/e2e-github-app-cli.ts`, `apps/api/package.json`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/session-state.ts`, `apps/web/e2e/sign-in.spec.ts`, `.env.example`, `scripts/setup-env.mjs`, `scripts/setup-env.test.mjs`, `scripts/dev.mjs`, `scripts/setup-github-app.mjs` (deleted), `scripts/github-app-manifest.mjs` (deleted), `scripts/github-app-manifest.test.mjs` (deleted), `scripts/github-app-callback.mjs` (deleted), `scripts/github-app-callback.test.mjs` (deleted), `scripts/github-app-conversion.mjs` (deleted), `scripts/github-app-conversion.test.mjs` (deleted), `package.json`

The API creates the GitHub App through GitHub's manifest flow and stores it in Postgres, so every install, desktop or team, sets it up from the web (D6). The five `GITHUB_APP_*` variables and `pnpm setup:github-app` go.

**Contracts.** A new `instance` router. `GithubFailed` moves from `repository.ts` to `github-failed.ts`, and both routers use it.

| Name | Shape |
| --- | --- |
| `GithubAppState` | `z.enum(['missing', 'configured'])` |
| `InstanceStatus` | `z.object({ githubApp: GithubAppState, githubAppSlug: z.string().nullable() })` |
| `SetupToken` | `z.string().min(32).max(200)` |
| `InstanceGithubAppManifestInput` | `z.strictObject({ setupToken: SetupToken })` |
| `InstanceGithubAppManifestOutput` | `z.object({ postUrl: z.url(), manifest: z.string().max(10_000) })` |
| `InstanceCompleteGithubAppInput` | `z.strictObject({ setupToken: SetupToken, code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) })` |

| Procedure | Who | Input | Output | Errors |
| --- | --- | --- | --- | --- |
| `instance.getStatus` | public | none | `InstanceStatus` | none |
| `instance.githubAppManifest` | setup token | `InstanceGithubAppManifestInput` | `InstanceGithubAppManifestOutput` | `UNAUTHORIZED`, `CONFLICT` |
| `instance.completeGithubApp` | setup token | `InstanceCompleteGithubAppInput` | `InstanceStatus` | `UNAUTHORIZED`, `CONFLICT`, `GITHUB_FAILED` |

**Table.** `github_apps` holds at most one row. It belongs to nothing and is never deleted by the app.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | `uuidv7()` |
| `singleton` | `boolean` | not null, default `true`, unique, `check (singleton)` |
| `app_id` | `bigint` | not null |
| `slug` | `text` | not null |
| `client_id` | `text` | not null |
| `client_secret_encrypted` | `text` | not null |
| `private_key_encrypted` | `text` | not null, the PKCS#8 key |
| `owner_login` | `text` | not null |
| `created_at` | `timestamptz` | not null, default now |

No index beyond the primary key and the `singleton` unique: every read takes the one row.

**API.**

- **Environment.** `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY` leave `env.ts` and `.env.example`, with `privateKeyPem`. `SETUP_TOKEN` is required, `z.string().min(32)`. `pnpm setup:env` writes 32 random bytes as base64url for it. `pnpm dev` prints `Set up Plangineer at http://localhost:5173/get-started#setup-token=<SETUP_TOKEN>` after the stack starts.
- **`github-app-store.ts`.** `createGithubAppStore({ db, secret })` is synchronous and returns `get()` and `save(conversion)`.
  - `get(): Promise<GithubAppCredentials | null>` decrypts the row with `symmetricDecrypt({ key: secret, data })` from `better-auth/crypto` and caches it. While nothing is cached, each call reads the row again, so a row another process inserts is seen without a restart.
  - `save` encrypts the client secret and the PKCS#8 key with `symmetricEncrypt`, inserts the row and caches it. An existing row makes `save` return `'exists'`, through the `singleton` unique and `onConflictDoNothing`.
  - `server.ts` calls `get()` once before listening, so a row that fails to decrypt stops the server at startup with `The stored GitHub App cannot be decrypted. BETTER_AUTH_SECRET changed since the App was created.`
  - `ServiceDeps` gains `appStore`, so services reach it as they reach `db`.
- **`github-app-manifest.ts`.** `buildManifest(origin)` returns the manifest from `scripts/github-app-manifest.mjs` at `59223b1`, with these changes: `name` is `plangineer-<6 hex>`, `redirect_url` is `<origin>/get-started`, `callback_urls` is `[<origin>/api/auth/callback/github]`, and `setup_url` is `<origin>/repositories`. `origin` is `BETTER_AUTH_URL`. `postUrl` is `https://github.com/settings/apps/new`, so the App belongs to the signed-in GitHub account (D7).
- **`github-app-conversion.ts`.** `convertManifestCode(code)` posts to `https://api.github.com/app-manifests/<code>/conversions` and parses `id`, `slug`, `client_id`, `client_secret`, `pem` and `owner.login` with Zod, as `readConversion` does at `59223b1`. A non-2xx answer or a bad body raises `GITHUB_FAILED` with GitHub's status and a message cut to `GITHUB_FAILED_MESSAGE_MAX`.
- **Setup token.** Both token procedures compare `sha256(input.setupToken)` with `sha256(env.SETUP_TOKEN)` using `timingSafeEqual`. A mismatch is `UNAUTHORIZED`. A configured App makes both answer `CONFLICT`, so the token is spent once an App exists. The logger redacts `setupToken`, `*.setupToken`, `code` under `instance` input, `client_secret`, `clientSecret`, `pem` and `privateKey`.
- **Auth.** `createAuth` takes `githubApp: GithubAppCredentials | null`. With `null`, `socialProviders` is empty, so a GitHub sign-in fails with Better Auth's provider-not-found error. `apps/api/src/auth/auth-provider.ts` exports `createAuthProvider({ db, env, appStore })`, whose `get(): Promise<Auth>` rebuilds the Better Auth instance when `appStore.get()` returns a different object. `createApp` takes the provider in place of an `Auth`. The `/api/auth/*` handler, the session middleware in `session.ts` and `run-event-stream.ts` each call `get()` per request. `auth-cli.ts` and `e2e-session-cli.ts` pass the stored App from `appStore.get()` to `createAuth`.
- **GitHub client.** `createGithub({ appStore, logger })` builds the Octokit `App` from `await appStore.get()` on first use, and again after the credentials change. With no App it throws `Error('GitHub App is not configured')`. No signed-in path can reach it, since sign-in needs the App. `repository-service.ts` builds `installUrl` from the stored App's slug.
- **First admin.** Unchanged: the first user who is not a seed user becomes admin. The desktop API listens only on `127.0.0.1`, so nobody else can sign in first (D8).
- **Dev reset.** `pnpm db:reset` reads the `github_apps` row before the reset and inserts it again after migrating, so a dev App survives every reset and `pnpm test:e2e`. A missing database or a missing `github_apps` table means there is no row to keep. The seed adds no App.
- **e2e App.** `e2e:github-app`, run as `node --env-file=../../.env src/test/e2e-github-app-cli.ts`, inserts an App with client ID `e2e-github-client-id` and a generated key when no row exists. It then prints `{"clientId": ...}` for the stored row. `scripts/test-e2e.mjs` runs it after `pnpm db:reset` and before Playwright, so the App exists before Playwright starts the API. The e2e global setup runs it again, which inserts nothing and prints the client ID. It saves the ID beside the session state, and `sign-in.spec.ts` reads it there in place of `.env`.
- **API tests.** `testEnv` drops the five GitHub values and gains `SETUP_TOKEN`. The API test global setup inserts an App row into the template database with `appStore.save`, so every cloned test database starts with one. `testDeps` and `testAuth` stay synchronous: they build a store and an auth provider that read that row. Tests of the missing state delete the row in their own database. `scripts/env-file.test.mjs` uses keys other than `GITHUB_APP_*` in its examples.

**Done when:**

- 4a. Each new input schema accepts a valid value and rejects a 31-character token, a code with a `/`, and an unknown key. Each output schema strips an unknown key.
- 4b. The migration applies from empty with `pnpm db:reset`, and a second `github_apps` row is rejected.
- 4c. `instance.getStatus` answers `missing` with no row and `configured` with the slug once a row exists, with no session.
- 4d. `instance.githubAppManifest` with the right token returns a manifest whose callback, redirect and setup URLs start with `BETTER_AUTH_URL`. A wrong token answers `UNAUTHORIZED`, and a configured App answers `CONFLICT`.
- 4e. `instance.completeGithubApp` with the right token and a code that the MSW GitHub handler converts stores one row with the client secret and key encrypted, and answers `configured`.
- 4f. `instance.completeGithubApp` answers `UNAUTHORIZED` for a wrong token, `CONFLICT` when a row exists, and `GITHUB_FAILED` with the status for a GitHub 404, storing nothing in each case.
- 4g. After `completeGithubApp`, `/api/auth/sign-in/social` with provider `github` redirects to GitHub's authorize URL with the stored client ID, with no restart. Before it, the same call fails.
- 4h. After `completeGithubApp`, an installation token request signs its JWT with the stored App ID and key.
- 4i. The captured pino output of a completed setup holds neither the setup token, the code, the client secret nor the key.
- 4j. A stored row that does not decrypt with `BETTER_AUTH_SECRET` stops the server at startup with the message above.
- 4k. `pnpm db:reset` keeps an existing `github_apps` row, succeeds on a database with no `github_apps` table, and `pnpm test:e2e` passes the sign-in journey with the e2e App on an empty database.
- 4l. `parseEnv` rejects a missing or 31-character `SETUP_TOKEN`, and `pnpm setup:env` writes a 43-character one.
- 4m. An App row inserted by another process after the API started is used by the next sign-in, with no restart.

### 5. Runner: machine-readable login and live Claude Code status

**Files:** `packages/contracts/src/runner-cli.ts`, `packages/contracts/src/runner-cli.test.ts`, `packages/contracts/src/runner-protocol.ts`, `packages/contracts/src/runner-protocol.test.ts`, `packages/contracts/src/index.ts`, `apps/runner/src/login-command.ts`, `apps/runner/src/login-command.test.ts`, `apps/runner/src/cli.ts`, `apps/runner/src/cli.test.ts`, `apps/runner/src/command-result.ts`, `apps/runner/src/start-command.ts`, `apps/runner/src/start-command-connection.test.ts`, `apps/api/src/runners/runner-socket.ts`, `apps/api/src/runners/runner-session.ts`, `apps/api/src/runners/runner-socket-lifecycle.test.ts`, `apps/runner/README.md`

- **`login --json`.** The desktop app reads the login's progress from the runner's stdout. With `--json`, `login` prints one `RunnerLoginEvent` per line and no other text. `--json` implies `--no-browser`.

| Event | Shape | When |
| --- | --- | --- |
| `login_started` | `{ event: 'login_started', userCode: string, approveUrl: string, expiresAt: string }` | After `startLogin` |
| `paired` | `{ event: 'paired', runnerId: string }` | After `runner.json` is written. Exit 0 |
| `failed` | `{ event: 'failed', message: string }` | On each failure step 4 of the [browser pairing plan](2026-10-08-runner-browser-pairing.md) names, with its message. Exit 1 |

`RunnerLoginEvent` is `z.discriminatedUnion('event', [...])` in `packages/contracts/src/runner-cli.ts`, with `message` at most 500 characters.

- **Claude Code status.** The runner detects Claude Code once at start today, so installing it later never shows. While connected, the runner runs `adapter.detect()` every 30,000 ms. When the result differs from the last one sent, it sends `z.strictObject({ type: z.literal('runner.clis'), clis: z.array(CliStatus).max(4) })`, a new `RunnerToServerMessage`. The API writes `clis` to the runner's row as the `hello` handler does. Every switch on the message type gains the case.
- **Exit codes.** `CommandResult` becomes `{ exitCode: 0 | 1 | 3; message: string | null }`. `cli.ts` sets `process.exitCode` from it and prints nothing when `message` is `null`, which is how `login --json` prints only its events. Code 3 means this runner needs pairing, so the desktop app can tell it from other failures. `apps/runner/README.md` lists the codes.

| `start` ends because | Exit code |
| --- | --- |
| No `runner.json` | 3 |
| `--server <url>` is given and differs from `runner.json`'s `serverUrl` | 3 |
| The control plane refuses the token (401) or closes with `revoked` | 3 |
| The control plane closes with `replaced` or `protocol` | 1 |

- **`start --server <url>`.** An optional flag. When given, `start` checks it against the paired server before connecting. An unreachable server keeps the runner reconnecting with backoff, as today, and never exits.

**Done when:**

- 5a. `RunnerLoginEvent` parses each event, rejects an unknown event, and rejects a 501-character message.
- 5b. Against a fake control plane, `login --json` prints `login_started` then `paired` as two JSON lines, writes `runner.json` and exits 0.
- 5c. A denied, expired or network-failed `login --json` prints one `failed` line and exits 1.
- 5d. A runner whose fake adapter changes from unavailable to available sends one `runner.clis` message within one interval, and none while the result is unchanged.
- 5e. The API stores the `clis` from a `runner.clis` message, and `runner.list` returns them.
- 5f. `start` exits 3 with no `runner.json`, with a `--server` that differs from it, and when the control plane refuses its token. It exits 1 on a `replaced` or `protocol` close.
- 5g. `login --json` prints nothing but its event lines on stdout.

### 6. Get started screen

**Files:** `packages/api-client/src/instance.ts`, `packages/api-client/src/instance.test.tsx`, `packages/api-client/src/index.ts`, `apps/web/src/routes/get-started.tsx`, `apps/web/src/features/get-started/get-started-screen.tsx`, `apps/web/src/features/get-started/get-started-screen.test.tsx`, `apps/web/src/features/get-started/github-app-step.tsx`, `apps/web/src/features/get-started/sign-in-step.tsx`, `apps/web/src/features/get-started/claude-code-step.tsx`, `apps/web/src/features/get-started/repository-step.tsx`, `apps/web/src/features/get-started/setup-token.ts`, `apps/web/src/features/get-started/setup-token.test.ts`, `apps/web/src/features/get-started/get-started-card.tsx`, `apps/web/src/features/get-started/get-started-card.test.tsx`, `apps/web/src/routes/_app/index.tsx`, `apps/web/src/features/auth/sign-in-card.tsx`, `apps/web/src/features/auth/sign-in-card.test.tsx`

`/get-started` is a public route beside `/sign-in`. It shows the four steps as cards in one column, at every width, in the order below. Desktop adds nothing beside them. Each card has a status icon (Lucide `CircleCheck` when done, `Circle` when not), a title, one line of text and at most two buttons. `visual-style` sets colors and type.

- **Hooks.** `useInstanceStatus()` queries `instance.getStatus`. `useGithubAppManifest()` and `useCompleteGithubApp()` are mutations, and `useCompleteGithubApp` sets the status query data on success.
- **Setup token.** `setup-token.ts` reads `#setup-token=<value>` from the URL on load, stores it in `sessionStorage` under `plangineer.setupToken`, and removes the fragment with `history.replaceState`.
- **Manifest state.** The GitHub App step makes a state of 16 random bytes as base64url and stores it under `plangineer.manifestState`. It posts a hidden form to `<postUrl>?state=<state>` with the field `manifest`. GitHub redirects back to `/get-started?code=<code>&state=<state>`. The screen calls `completeGithubApp` only when the state equals the stored one, then removes both query values and the stored state (D9).

| Step | States and buttons |
| --- | --- |
| 1. Create the GitHub App | **Missing, token present:** "Create the GitHub App on your GitHub account. GitHub asks you to confirm." Button **Create GitHub App**. **Missing, no token:** "Open this page from the link the Plangineer app or server gave you." No button. **Creating:** button disabled with a spinner, from the click through the completion call. **State mismatch:** "This link did not come from this setup. Start again." Button **Create GitHub App**. **Failed:** GitHub's message and button **Try again**. **Done:** "GitHub App `<slug>` is ready." Link **Open on GitHub** |
| 2. Sign in | **Blocked** until step 1 is done: no button. **To do:** button **Sign in with GitHub**, to `/sign-in?redirect=/get-started`. **Done:** "Signed in as `<name>`." |
| 3. Claude Code | Needs step 2. Reads the first page of `runner.list` with `limit: 100` every 5 s, and considers only active runners. **Done** wins when any online runner has Claude Code available. Otherwise the step is **unavailable** when any runner is online, else **offline**. Each state names the runner with the latest `lastSeenAt` among those it considers. **No runner:** "Connecting this computer's runner." In a browser that is not the desktop app, it shows the Add runner card's command instead. **Runner online, Claude Code unavailable:** "Install Claude Code, then run `claude` once in a terminal to sign in." Link **Install Claude Code** to `https://code.claude.com/docs/en/setup`. **Done:** "Claude Code `<version>` on `<runner name>`." **Runner offline:** "`<runner name>` is offline." |
| 4. Add a repository | Needs step 2. Reads `repository.list` with `limit: 1`. **To do, admin:** button **Add repository**, to `/repositories`. **To do, member:** "An admin adds repositories." **Done:** "`<owner>/<name>` added." |

- Once every step is done, the screen shows a button **Open Plangineer** to `/`.
- **Remote states.** The status query shows a skeleton per card while loading and a failed card with **Try again** when the query fails. With stale data it keeps the cards and shows "Reconnecting" under the heading. Steps 3 and 4 have no empty state beyond their "to do" states.
- **Desktop detection.** The desktop app adds ` Plangineer-Desktop/<version>` to its user agent (step 8). The Claude Code step uses it only to choose which text to show for "No runner".
- **Home card.** `_app/index.tsx` shows `GetStartedCard` above the account summary while step 3 or 4 is not done. The card reads "Finish setting up Plangineer" with a button **Get started**.
- **Sign-in card.** With `githubApp: 'missing'`, the sign-in card shows "Plangineer is not set up yet." with a button **Get started** in place of the GitHub button.

**Done when:**

- 6a. A fragment `#setup-token=<value>` is stored in `sessionStorage` and removed from the URL.
- 6b. With a token and no App, **Create GitHub App** posts a form to GitHub's `postUrl` with the manifest and a state that is stored.
- 6c. Returning with a matching state calls `completeGithubApp` once and shows step 1 done. A mismatched state shows the mismatch text and calls nothing.
- 6d. Each step renders each of its states in the table, from MSW responses.
- 6e. The screen shows a skeleton while loading, a failed card with **Try again** on a failed status query, and "Reconnecting" with stale data.
- 6f. The home card shows while step 3 or 4 is not done and hides once both are.
- 6g. The sign-in card shows **Get started** in place of the GitHub button when the App is missing.
- 6h. Screenshots at 1280 px and 375 px show `/get-started` in each step 1 state, with steps 3 and 4 each to do and done, and no horizontal scroll or target under 44 px.

### 7. Desktop app package

**Files:** `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/tsdown.config.ts`, `apps/desktop/src/main.ts`, `apps/desktop/src/desktop-paths.ts`, `apps/desktop/src/server-env.ts`, `apps/desktop/src/server-env.test.ts`, `apps/desktop/src/postgres.ts`, `apps/desktop/src/postgres.test.ts`, `apps/desktop/src/postgres.stack.test.ts`, `apps/desktop/src/stack.ts`, `apps/desktop/src/stack.stack.test.ts`, `apps/desktop/vitest.stack.config.ts`, `apps/desktop/src/node-process.ts`, `apps/desktop/src/stop-process-tree.ts`, `apps/desktop/src/stop-process-tree.test.ts`, `apps/desktop/src/user-path.ts`, `apps/desktop/src/user-path.test.ts`, `apps/desktop/src/startup.html`, `apps/desktop/src/api-client.ts`, `apps/desktop/src/port-check.ts`, `apps/desktop/src/port-check.test.ts`, `apps/desktop/vitest.config.ts`, `.dependency-cruiser.cjs`, `knip.json`, `.gitignore`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`

`apps/desktop` is the Electron 44.7.0 main process and imports only `contracts` (D2, D3). It starts the stack in a fixed order and stops it in reverse. It holds no server logic, no preload script and no IPC: it launches the bundles from step 2 and talks to the API over HTTP.

- **Dependencies.** `electron` 44.7.0, `electron-updater` 6.8.9, `env-paths` 4.0.0, `execa` 10.1.0, `shell-env` 4.0.3, `@orpc/client` 1.15.5, `@orpc/contract` 1.15.5 and `@plangineer/contracts` (`workspace:*`). Every one is a `devDependency`, and `dependencies` stays empty: electron-builder requires `electron` there and copies production dependencies into the app. tsdown bundles everything except `electron` into `apps/desktop/dist/main.mjs`, so the packaged app ships no `node_modules`. `.gitignore` adds `apps/desktop/dist/`. `pnpm-workspace.yaml`'s `allowBuilds` gets `electron: true`, since its install script downloads the Electron binary.
- **API client** (`api-client.ts`). `createDesktopClient(origin, fetch)` builds a `ContractRouterClient` with `RPCLink`, `SimpleCsrfProtectionLinkPlugin` and `ResponseValidationPlugin(contract)`, as the runner's `login-command.ts` does. The window session's `fetch` is passed in, so calls carry the signed-in cookie and pass the API's CSRF check.
- **Tests.** `apps/desktop/vitest.config.ts` is the `desktop` project the root config picks up, and it excludes `*.stack.test.ts`. Tests that need the Postgres binaries or the step 2 bundles are named `*.stack.test.ts`, and `vitest.stack.config.ts` runs only them, as the `test:stack` script. Step 9's workflow runs it on every system. Stack tests pass a temp config, data and log folder and two free ports into `ensureServerEnv` and `startStack`, so they never use 47100, 47101 or the person's data. They sign a user in by running `node apps/api/src/test/e2e-session-cli.ts` with the stack's environment and no `--env-file`, which creates a new user in the stack's database.
- **Paths.** `desktop-paths.ts` takes `envPaths('Plangineer', { suffix: '' })`. Resources are `process.resourcesPath` when packaged and `apps/desktop/stage/` from the checkout (step 9 fills it).

| What | Where |
| --- | --- |
| Server environment | `<config>/server.env`, mode 0600 |
| Postgres data | `<data>/postgres` |
| Runner data | `<data>/runner`, passed as `PLANGINEER_RUNNER_DATA_DIR` |
| Logs | `<log>/api.log`, `<log>/postgres.log`, `<log>/desktop.log` |
| Bundles | `<resources>/server/dist/main.mjs`, `<resources>/server/dist/migrate.mjs`, `<resources>/runner/dist/cli.mjs` |
| Web app | `<resources>/web` |
| Postgres binaries | `<resources>/postgres/bin` |

- **`server.env`.** On first start, `ensureServerEnv()` reads `<resources>/server/env.example`, a copy of `.env.example`, with `util.parseEnv`. It copies every key except `API_LOG_FILE`, overrides these values, and writes the file through a temp file and rename:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://plangineer:<password>@127.0.0.1:47101/plangineer`, with a 32-byte base64url password |
| `API_HOST` | `127.0.0.1` |
| `API_PORT` | `47100` |
| `BETTER_AUTH_URL` | `http://127.0.0.1:47100` |
| `BETTER_AUTH_SECRET` | 32 random bytes as base64url |
| `SETUP_TOKEN` | 32 random bytes as base64url |

On later starts, the file is the source of truth and is never rewritten. A key that `env.example` has and the file lacks is appended with its example value, so a release that adds a variable starts (D10). `API_LOG_FILE` is never appended or stored. It and `WEB_DIST_DIR` point into the logs and install folders, so they are passed at launch. `ensureServerEnv` takes the ports as arguments, 47100 and 47101 in the app.

- **Postgres** (`postgres.ts`, D11). Binaries are `initdb`, `pg_ctl`, `psql` and `createdb`, with `.exe` on Windows, run with execa and `windowsHide: true`. The port and password come from `DATABASE_URL`, and the client tools get `PGPASSWORD`.
  1. With no `<data>/postgres/PG_VERSION`, write the password to a temp file with mode 0600 and run `initdb -D <dir> -U plangineer --pwfile <file> --auth=scram-sha-256 --encoding=UTF8 --locale=C`, then delete the file.
  2. A `PG_VERSION` other than `18` stops the start with `The database was created by Postgres <n>. This version of Plangineer runs Postgres 18.`
  3. Run `pg_ctl status -D <dir>`. Exit 0 means a server from this folder is still running, left by a crash, and the desktop uses it. Otherwise check the port is free (below), then run `pg_ctl start -D <dir> -w -t 60 -l <log>/postgres.log` with `PGPORT` set. Postgres listens on `localhost`, its default.
  4. On every start, run `psql -h 127.0.0.1 -p <port> -U plangineer -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'plangineer'"`. When it prints nothing, run `createdb -h 127.0.0.1 -p <port> -U plangineer plangineer`. A first run cut off before `createdb` is finished on the next start.
  5. Stop with `pg_ctl stop -D <dir> -m fast -w -t 30`.
- **Port check** (`port-check.ts`). `isPortFree(host, port)` listens on the port with `node:net` and closes at once. A busy port stops the start with `Port <n> is in use by another program. Free it, or change the port in <server.env path> as the desktop app guide describes.` The API port is checked before step 4 of the start order, and the Postgres port before `pg_ctl start`.
- **Node processes** (`node-process.ts`). The migrate bundle, the API and the runner run with `utilityProcess.fork(modulePath, args, { env, stdio: 'pipe', serviceName })` on Electron's Node 24.21.0. `env` is the desktop's `process.env` merged with the values each process needs. `utilityProcess` takes a whole environment object, so this is the one place the desktop builds one (D12). Child stdout and stderr go to `desktop.log`.
- **Runner `PATH`.** On macOS and Linux, an app opened from the dock or menu gets a minimal `PATH` that lacks `~/.local/bin`, where Claude Code installs, and Homebrew's `git`. `user-path.ts` reads the login shell's `PATH` with `shell-env` and passes it to the runner. On Windows the runner gets the desktop's `Path` unchanged.
- **Stopping** (`stop-process-tree.ts`). The runner and API stop with `taskkill /pid <pid> /T /F` on Windows and `process.kill(pid, 'SIGTERM')` elsewhere. Each gets 10 s to exit before `SIGKILL`. The runner's own `SIGTERM` handler already stops its runs' process groups.
- **Start order** (`stack.ts`). `startStack()` runs each step and stops at the first failure:
  1. `ensureServerEnv()`.
  2. Start Postgres.
  3. Run `migrate.mjs`, and require exit 0. Every start runs it, so an upgrade migrates before the API starts (D11).
  4. Check the API port, then fork `main.mjs` with every `server.env` value plus `API_LOG_FILE` and `WEB_DIST_DIR`.
  5. Poll `GET <BETTER_AUTH_URL>/api/auth/ok` every 250 ms until it answers 200, for up to 60 s. The poll races the API's exit: if the API exits first, the step fails with `The API stopped with exit code <n>: <last stderr line>`.

  `migrate.mjs` gets `DATABASE_URL` alone (step 1). A failed `migrate.mjs` shows its exit code and last stderr line too.
- **Failures.** The startup window, `startup.html`, shows "Starting Plangineer" while the stack starts. A failed step shows a native dialog naming the step and its message, with the buttons **Retry**, **Open logs folder** and **Quit**. A port already in use names the port and `server.env`'s path.
- **Shutdown.** `stopStack()` stops the runner, then the API, then Postgres.

**Done when:**

- 7a. `ensureServerEnv()` writes every key of the example except `API_LOG_FILE`, with the six overrides, at mode 0600 on macOS and Linux, and a second call changes nothing.
- 7b. `ensureServerEnv()` appends a key the example has and the file lacks, keeps every existing value, and never appends `API_LOG_FILE`.
- 7c. Against the real Postgres 18.6.0 binaries, `postgres.ts` initializes an empty folder, starts, accepts a connection with the generated password on `127.0.0.1` with `listen_addresses` set to `localhost`, stops, and starts again with the data kept.
- 7d. A data folder whose `PG_VERSION` is `17` fails with the message above, and `pg_ctl` never runs.
- 7e. `startStack()` with the step 2 bundles and real Postgres reaches 200 on `/api/auth/ok` within 15 s on a warm start, and `stopStack()` leaves no Postgres, API or runner process.
- 7f. On Windows the stop runs `taskkill` with `/T /F`, and on macOS and Linux it sends `SIGTERM`, then `SIGKILL` after 10 s.
- 7g. `user-path.ts` returns the login shell's `PATH` on macOS and Linux, and the unchanged `Path` on Windows.
- 7h. dependency-cruiser allows `apps/desktop` to import only `contracts`, and fails an import into any other app.
- 7i. With a server from the data folder already running, `postgres.ts` uses it and runs no `pg_ctl start`.
- 7j. A data folder with `PG_VERSION` and no `plangineer` database gets the database on the next start.
- 7k. A busy API port or Postgres port fails the start with the port-in-use message, before any process starts on it.
- 7l. An API that exits during startup fails the start within 1 s of its exit, with its exit code and last stderr line.
- 7m. After a stack start and a pairing, `desktop.log` holds neither the Postgres password nor the runner token.

### 8. Window, runner pairing, tray, login item and updates

**Files:** `apps/desktop/src/main.ts`, `apps/desktop/src/app-window.ts`, `apps/desktop/src/navigation-policy.ts`, `apps/desktop/src/navigation-policy.test.ts`, `apps/desktop/src/runner-pairing.ts`, `apps/desktop/src/runner-pairing.test.ts`, `apps/desktop/src/runner-pairing.stack.test.ts`, `apps/desktop/src/tray.ts`, `apps/desktop/src/login-item.ts`, `apps/desktop/src/login-item.test.ts`, `apps/desktop/src/updates.ts`, `apps/desktop/src/updates.test.ts`

- **Single instance.** `app.requestSingleInstanceLock()`. A second launch shows the existing window and exits.
- **Window** (`app-window.ts`). One `BrowserWindow` on the partition `persist:plangineer`, with `contextIsolation`, `sandbox`, no `nodeIntegration` and no preload. Its user agent is Electron's default plus ` Plangineer-Desktop/<app version>`. After `startStack()`, the desktop calls `instance.getStatus`. With `missing`, the window opens `<BETTER_AUTH_URL>/get-started#setup-token=<SETUP_TOKEN>`. Otherwise it opens `<BETTER_AUTH_URL>/`. Closing the window hides it, and the stack keeps running.
- **Navigation policy** (`navigation-policy.ts`). Navigation stays in the window for `BETTER_AUTH_URL`'s origin and `https://github.com`, where sign-in, the App's creation and its install happen. Any other `http` or `https` navigation or new window opens in the default browser with `shell.openExternal`. Every other scheme is refused.
- **Runner pairing** (`runner-pairing.ts`, D13). Once the API is up, the desktop forks the runner with `start --server <BETTER_AUTH_URL>`. It never reads the runner's files. When `start` exits 3, which means no pairing, a pairing for another origin or a revoked token, the desktop polls `GET /api/auth/get-session` every 2 s through the window's session, using `session.fetch`. Once a user is signed in:
  1. Fork the runner with `login --server <BETTER_AUTH_URL> --name <os.hostname()> --json`.
  2. Read its first line as `RunnerLoginEvent`. On `login_started`, call `runner.approveLogin({ userCode })` with an oRPC client whose `fetch` is the window session's `fetch`, so the signed-in user approves it.
  3. Wait for `paired` and exit 0. Then fork the runner with `start --server <BETTER_AUTH_URL>` again.
  4. On `failed`, an approve error or a nonzero exit, log it to `desktop.log` and try again on the next session poll, at most 3 times per launch.

  `login` overwrites `runner.json`, so a changed port or a revoked runner pairs again by the same path. A runner that exits with code 1 is started again after 5 s.
- **Tray** (`tray.ts`). Menu items, in order: **Open Plangineer**, **Open at login** (checkbox), **Check for updates**, **Open logs folder** and **Quit Plangineer**. On macOS, clicking the dock icon also opens the window.
- **Login item** (`login-item.ts`). **Open at login** is on after the first successful start (D21), and the app then starts with `--hidden`, which runs the stack and tray with no window.

| System | How |
| --- | --- |
| Windows | `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })` |
| macOS | A LaunchAgent `io.github.tankafide.plangineer.plist` in `path.join(app.getPath('home'), 'Library', 'LaunchAgents')`, with `ProgramArguments` set to the app's executable and `--hidden`, and `RunAtLoad` true. Rewritten on each start while on, so a moved app keeps working |
| Linux | `plangineer.desktop` in `path.join(app.getPath('appData'), 'autostart')`, with `Exec="<APPIMAGE path>" --hidden` and `X-GNOME-Autostart-enabled=true` |

On macOS, an app not in `/Applications` asks once to move there with `app.moveToApplicationsFolder()`, so the login item and updates have a stable path.

- **Updates** (`updates.ts`, D15). electron-updater uses the GitHub provider from step 9's publish settings. It checks at start and every 6 hours.
  - **Windows and Linux.** Downloads in the background, then the tray adds **Restart to update to `<version>`**, and the update installs on quit.
  - **macOS.** An unsigned app cannot replace itself, so `autoDownload` is off. A found update adds **Download Plangineer `<version>`** to the tray, which opens `https://github.com/tankafide/Plangineer/releases/tag/v<version>`.

**Done when:**

- 8a. The navigation policy keeps the app origin and `https://github.com` in the window, sends other `http` and `https` URLs to the default browser, and refuses `file:` and `javascript:`.
- 8b. Against the step 2 API bundle with a signed-in session cookie, `runner-pairing.ts` runs `login --json`, approves the login request as that user, and the runner reaches `paired` with `runner.json` written.
- 8c. A pairing whose approve call fails is retried on the next poll, and stops after 3 failures in one launch.
- 8d. The login item writes the LaunchAgent plist on macOS and the autostart file on Linux with `--hidden`, and removes each when turned off.
- 8e. On macOS a found update offers the release page and downloads nothing. On Windows and Linux it downloads and offers a restart.
- 8f. Opening the packaged app with `--hidden` starts the stack, `/api/auth/ok` answers 200, and no window is visible.
- 8g. A runner that exits with code 3 is paired again, and one that exits with code 1 is started again after 5 s.

### 9. Packaging and releases

**Files:** `scripts/fetch-postgres.mjs`, `scripts/fetch-postgres.test.mjs`, `scripts/build-desktop.mjs`, `scripts/build-desktop.test.mjs`, `scripts/render-desktop-icons.mjs`, `scripts/release-assets.mjs`, `apps/desktop/build/icon.svg`, `apps/desktop/build/icon.png`, `apps/desktop/build/tray-icon.png`, `apps/desktop/build/tray-icon@2x.png`, `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, `apps/desktop/e2e/first-run.spec.ts`, `apps/desktop/playwright.config.ts`, `apps/desktop/vitest.stack.config.ts`, `package.json`, `.gitignore`, `.github/workflows/desktop.yml`

- **Postgres binaries.** `fetch-postgres.mjs [--platform <win32|darwin|linux>] [--arch <x64|arm64>]` defaults to the current system. It downloads `https://github.com/theseus-rs/postgresql-binaries/releases/download/18.6.0/postgresql-18.6.0-<triple>.tar.gz`, checks its SHA-256 against the pinned value, and extracts it into `apps/desktop/stage/postgres` without its top folder, using `tar` 7.5.22. A hash mismatch deletes the download and exits 1.

| Platform and arch | Triple | SHA-256 |
| --- | --- | --- |
| win32 x64 | `x86_64-pc-windows-msvc` | `7da44c2dbcda3b49688ea08ce8cf99cfe677adf565f53a9145bf9002c74db7d5` |
| darwin arm64 | `aarch64-apple-darwin` | `a257bcdb8aa3301a13d6a5bcec48f8c9517045b7cbae71e50788b2615539e95b` |
| darwin x64 | `x86_64-apple-darwin` | `f8918fbe747e0d79bda58ad8f8afcf23ac384b847ff3af18856f0825ba54b031` |
| linux x64 | `x86_64-unknown-linux-gnu` | `bb3d09f876b2383e25a8c9ce09e32d185a03656a23d074f5195542b1b1b3ca61` |

- **Staging.** `build-desktop.mjs [--publish <never|always>]` runs `pnpm build`, then `fetch-postgres.mjs`, then fills `apps/desktop/stage/` (gitignored):

| Stage path | From |
| --- | --- |
| `server/dist/` | `apps/api/dist/` |
| `server/drizzle/` | `apps/api/drizzle/` |
| `server/src/setup/templates/` | `apps/api/src/setup/templates/` |
| `server/env.example` | `.env.example` |
| `web/` | `apps/web/dist/` |
| `runner/dist/`, `runner/package.json` | `apps/runner/dist/`, `apps/runner/package.json` |
| `postgres/` | `fetch-postgres.mjs` |

  It then builds `apps/desktop` and runs electron-builder through `binPath` and `process.execPath`, with `--publish` passed through, default `never`. Root scripts: `desktop:build` runs `node scripts/build-desktop.mjs`, and `desktop:start` runs Electron on `apps/desktop` against the stage.
- **electron-builder** (`electron-builder.yml`). `appId: io.github.tankafide.plangineer`, `productName: Plangineer`, `files: [dist/**, package.json]`, and `extraResources` from `stage/` to the resources root.

| System | Target | Notes |
| --- | --- | --- |
| Windows | NSIS, x64 | `oneClick: true`, `perMachine: false`, so no admin prompt. Unsigned (D15) |
| macOS | `dmg` and `zip`, arm64 and x64, one build per arch | `identity: "-"` for an ad-hoc signature, which Apple silicon requires. `hardenedRuntime: false`. The zip only feeds the update metadata |
| Linux | AppImage, x64 | Category `Development` |

  `publish` is `{ provider: github, owner: tankafide, repo: Plangineer, releaseType: draft }`. The app's version is `apps/desktop/package.json`'s, starting at `0.1.0`, and its tag is `v<version>`.
- **Icons.** `icon.svg` is the Lucide `blocks` icon in white on a rounded square of the `visual-style` primary color. `render-desktop-icons.mjs` renders it to `icon.png` (1024 px), `tray-icon.png` (16 px) and `tray-icon@2x.png` (32 px) with Playwright's screenshot and a transparent background. Playwright is a dependency of `apps/web`, so the script resolves `@playwright/test` with `createRequire` from `apps/web/package.json` and imports that path. The PNGs are committed.
- **Workflow** (`desktop.yml`). It runs on pull requests that touch `apps/`, `packages/`, `scripts/` or the workflow, and on tags `v*`. A matrix of `windows-latest` (x64), `macos-latest` (arm64), `macos-15-intel` (x64) and `ubuntu-latest` (x64) runs `pnpm desktop:build`. Then it runs `pnpm --filter @plangineer/desktop test:stack`, the Vitest project for 7c to 7e and 8b, on that system. `ubuntu-latest` also runs `first-run.spec.ts` under `xvfb-run`. On a tag, the build runs with `--publish always` and `GH_TOKEN`, under `permissions: contents: write`, which fills a draft release. The engineer publishes the draft.
- **Desktop journey** (`first-run.spec.ts`). It launches the packaged Linux app with Playwright's `_electron.launch`, with `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` set to temp folders. It waits for the window to show `/get-started` with **Create GitHub App** enabled, quits, and checks that `server.env` exists and no Postgres process is left. A second test launches with `--hidden` and checks 8f.
- **Release check.** `scripts/release-assets.mjs <tag>` runs `gh release view <tag> --json assets` with execa and fails naming each asset of 9e that is missing.

**Done when:**

- 9a. `fetch-postgres.mjs` extracts `bin/initdb` for the given target, and a file whose hash differs makes it exit 1 with nothing extracted.
- 9b. `build-desktop.mjs` lays out `stage/` as the table says, and fails naming the first missing source path.
- 9c. `pnpm desktop:build` produces the installer for its system on each of the four matrix jobs.
- 9d. The packaged Linux app, opened with empty data folders, shows `/get-started` with **Create GitHub App** enabled, and leaves no Postgres process after quitting.
- 9e. A `v*` tag creates a draft release holding the Windows installer, both macOS dmgs and the AppImage, with `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.

### 10. Docs and rules

**Files:** `docs/engineering/stack-decisions.md`, `docs/plans/mvp-roadmap.md`, `docs/product/mvp.md`, `README.md`, `docs/engineering/desktop-app.md`, `.agents/skills/auth-and-access/SKILL.md`, `.agents/skills/github-integration/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/data-model-design/SKILL.md`, `.agents/skills/tooling-and-infra/SKILL.md`, `.agents/skills/cross-platform/SKILL.md`

- **`stack-decisions.md`.** Add rows: Desktop (Electron 44, electron-builder 26, electron-updater 6, Postgres 18.6.0 binaries from theseus-rs), and the package layout row `apps/desktop | Electron shell that launches the server, web and runner bundles | contracts`. Commands: remove `pnpm setup:github-app`, and add `pnpm build`, `pnpm desktop:build` and `pnpm desktop:start`. `pnpm setup:env` now writes `SETUP_TOKEN` and no GitHub values. `pnpm dev` prints the Get started link.
- **`desktop-app.md`.** What the app installs and where, per system: the paths table from step 7, the first-run steps with the manual clicks, the unsigned-build warnings and how to pass them on macOS and Windows, how to change a port: `API_PORT` and `BETTER_AUTH_URL`, or the port in `DATABASE_URL`, in `server.env`, then the GitHub App's callback, setup and redirect URLs on GitHub to match, after which the runner pairs again by itself (step 8), and how to move to a team server by `pg_dump` of the embedded database with the bundled `pg_dump`. It states the webhook limit (D16).
- **`README.md`.** The install section links to the latest release and `desktop-app.md`. The developer checkout section follows.
- **Roadmap and MVP doc.** The desktop row records this plan, and the MVP's open "Desktop shell and packaging" item is answered.
- **Skills.**
  - `auth-and-access`: the GitHub client credentials come from the stored GitHub App, not the environment.
  - `github-integration`: the App lives in `github_apps`, created through `instance.*`, with the key encrypted.
  - `security`: the Webhooks row adds `instance.githubAppManifest` and `instance.completeGithubApp` as unauthenticated writes bounded by the setup token and spent once an App exists. Redaction adds `setupToken`, `client_secret` and `pem`.
  - `data-model-design`: a GitHub App record, one row, never deleted by the app, secrets encrypted.
  - `tooling-and-infra`: the `bundle` CI job and the `desktop.yml` workflow.
  - `cross-platform`: the `utilityProcess` environment exception from D12.
- Run `pnpm skills:sync` and `pnpm skills:lint`.

**Done when:**

- 10a. `pnpm skills:lint` passes.
- 10b. A search for `setup:github-app` and `GITHUB_APP_` finds nothing in `docs/engineering/`, `.agents/skills/`, `scripts/`, `apps/` source, `packages/` source or `.env.example`.

## Decisions

All decisions were made on Oct 8, 2026. The engineer chose D6 and D15. The planner made the rest, and the engineer can overrule any of them.

- **D1. Inputs.** Base commit `59223b18d6a1638c50bfdb8c7d8bd86b7feb3849` on `main`. Exploration and the packaging research ran in subagents during planning, and their findings are folded in here.
- **D2. Electron 44, not Tauri 2.** Electron 44.7.0 ships Node 24.21.0, the stack's runtime, so the API and runner run in `utilityProcess` children with no second Node binary. Tauri would need the server and runner as sidecar executables per platform, built with Node SEA or pkg and signed separately, and a different webview per system. electron-builder 26.15.3 is chosen over Electron Forge because only electron-builder builds and updates an AppImage.
- **D3. A thin shell.** `apps/desktop` holds no server logic, no preload and no IPC. It provisions `server.env`, runs Postgres, runs the bundles and talks to the API over HTTP as the signed-in user. A team server needs a different launcher, a container image that runs `migrate.mjs` then `main.mjs` with `WEB_DIST_DIR` set, and no different server code. `DATABASE_URL` stays the one database switch, and `BETTER_AUTH_URL` the one public origin. The desktop always runs its own Postgres, since it serves one engineer.
- **D4. Bundles, not Node SEA.** SEA on Node 24 takes only a CommonJS entry, and its ESM backport is unmerged. tsdown bundles each app into ESM files that Electron's Node runs as they are. The runner's npm package uses the same full bundle, so there is one runner build.
- **D5. The API serves the web app when `WEB_DIST_DIR` is set.** One origin serves `/api`, `/rpc` and the SPA, which Better Auth's cookies and the web app's `window.location.origin` calls already assume. Dev keeps Vite and its proxy, so the variable is optional, which is the one optional API variable.
- **D6. The GitHub App lives in the database, set up from the web (engineer's choice).** All four checklist steps sit on one screen, and a team server gets the same setup with no environment editing. The client secret and key are encrypted with Better Auth's `symmetricEncrypt` and `BETTER_AUTH_SECRET`, as Better Auth encrypts OAuth tokens. The webhook secret is not stored, because no webhook is used yet. Rejected: the shell running the manifest flow and writing `GITHUB_APP_*` to its env file, which splits the checklist and leaves a team server needing a CLI.
- **D7. The App belongs to the signed-in GitHub account.** The manifest posts to `github.com/settings/apps/new`. An App for an organization is left out. GitHub lets the owner transfer an App later.
- **D8. A setup token guards App creation.** Before an App exists, nobody can sign in, so the token is the only check. The desktop generates it and puts it in the window's URL fragment, which never reaches a server log. A team server's operator sets it. Both token procedures refuse once an App exists. The first admin stays the first non-seed user to sign in. On a team server, someone could sign in between App creation and the operator. That race is team server work, left out here.
- **D9. The manifest state is checked in the browser.** The state is random, kept in `sessionStorage`, and compared before the code is sent. A forged link carrying another App's code fails the comparison. The token check still guards the API.
- **D10. `server.env` gains new keys on upgrade.** An installed app must start after an update that adds a variable. The desktop appends missing keys from the shipped example and never changes an existing value. Rejected: failing until the person edits the file, which needs a terminal.
- **D11. Postgres 18.6.0 from theseus-rs, run with `pg_ctl`.** The binaries are under the PostgreSQL license, current, pinned by SHA-256 and bundled at build time, so first run works offline. `pg_ctl` waits for readiness and runs Postgres safely under an admin account on Windows. Rejected: `embedded-postgres` 18.4.0-beta.17. It is a beta that lags upstream, its start can hang on a non-English locale, its stop can hang, it fails inside `app.asar`, and on Windows its server is tied to the parent console. Data stays under `env-paths`. Migrations run on every start, so an upgrade migrates before the API starts. A new Postgres major needs `pg_upgrade`, which is left out, so the app refuses data from another major.
- **D12. `utilityProcess` gets a whole environment object.** The `cross-platform` rule against copying `process.env` protects Windows' case-insensitive `Path`. `utilityProcess.fork` accepts only a full object, so the desktop merges into a copy in `node-process.ts` alone, and `cross-platform` records the exception.
- **D13. The desktop approves its own runner.** The desktop starts the login request itself, reads the user code from the runner's stdout and approves it through the window's signed-in session. No approval page appears and no secret leaves the machine. The request never passes through a link, so the phishing defense the approval page provides is not needed. The runner belongs to whoever signs in first in the window. A second machine still pairs with `plangineer-runner login`.
- **D14. Left out of the first version.** Hosted or team deployment, Codex, the mobile app, Windows and Linux on arm64, `.deb` and `.rpm`, organization-owned Apps, Postgres major upgrades, and a standalone runner binary. The roadmap asked the plan to settle the standalone binary. The desktop runs the runner on Electron's Node, so a binary would serve only second machines, where `npx plangineer-runner` works. It can be built later with Node SEA once the ESM backport lands.
- **D15. Unsigned installers on GitHub Releases (engineer's choice).** The repository is public, and people download installers from its releases with no store. On macOS, the first open needs System Settings > Privacy & Security > Open Anyway, and updates are offered as a download. On Windows, SmartScreen asks once, and updates install themselves. AppImage updates itself. The macOS login item uses a LaunchAgent, since `setLoginItemSettings` can fail silently for an unsigned app. Signing can be added later with no redesign.
- **D16. Webhooks need a public URL.** The manifest keeps webhooks inactive, as today. A later feature that needs GitHub events will not work from a laptop without a tunnel, and `desktop-app.md` says so.
- **D17. Fixed ports 47100 and 47101 on `127.0.0.1`.** The GitHub App's callback URL holds the port, so it must not change between runs. A port in use stops the start with a message naming it.
- **D18. No seed in the desktop app.** The seed is dev data: fake users and `acme` repositories. The desktop migrates only.
- **D19. Sign-in happens in the app window.** The session cookie must land in the window that uses it. GitHub's password, authenticator app, GitHub Mobile and security key sign-ins work there. A macOS passkey may not, and the person then uses another GitHub method.
- **D20. One build for the published runner.** Bundling every dependency into `plangineer-runner` removes its install step and matches what the desktop runs. The cost is a larger package, which `npx` downloads once.
- **D21. Open at login is on by default.** The request asks for the runner to keep running at login, and runs need the local API and Postgres too, so the whole app starts hidden at login. The person turns it off with the tray's **Open at login** checkbox.
- **D22. The desktop asks the runner, not its files.** `start --server` and exit code 3 tell the desktop when to pair, so the desktop never reads `runner.json` and the runner's file format stays its own.
- **D23. The GitHub App store re-reads until it finds a row.** The e2e CLI and a second API process can insert the App while an API runs. Reading again while nothing is cached costs one primary-key read per request only before setup.

## Constraints

| Constraint | Target | Check |
| --- | --- | --- |
| C1. Local only | Postgres and the API listen only on loopback addresses in the desktop app | 1d, 7c |
| C2. Secrets stay secret | The setup token, App client secret and key, Postgres password and runner token never appear in a log, URL query or API response. The single-use manifest code appears only in GitHub's one redirect to `/get-started`, which removes it with `replaceState` | 4i, 6c, 7a, 7m |
| C3. Clean stop | Quitting leaves no Postgres, API or runner process | 7e, 9d |
| C4. Fast start | A warm start reaches `/api/auth/ok` within 15 s on the CI runners | 7e |

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. API logger writes stdout and file | ✓ | | | | | |
| 1b. Runner logger without a worker | ✓ | | | | | |
| 1c. New variables required | ✓ | | | | | |
| 1d. API binds to `API_HOST` | | ✓ | | | | |
| 1e. Assets through `PACKAGE_ROOT` | | ✓ | | | | |
| 1f. Migrate needs only `DATABASE_URL` | | ✓ | | | | |
| 1g. Log path from `PACKAGE_ROOT` | ✓ | | | | | |
| 2a. Builds produce their files | | | | | ✓ | |
| 2b. Bundle smoke on three systems | | ✓ | | | | |
| 2c. Bundled runner prints its version | | ✓ | | | | |
| 3a. SPA and assets served | | ✓ | | | | |
| 3b. API 404s stay | | ✓ | | | | |
| 3c. No web without the variable | | ✓ | | | | |
| 4a. Instance schemas | ✓ | | | | | |
| 4b. Migration and one row | | ✓ | | | | |
| 4c. Status without session | | ✓ | | | | |
| 4d. Manifest and its errors | | ✓ | | | | |
| 4e. App stored encrypted | | ✓ | | | | |
| 4f. Completion errors store nothing | | ✓ | | | | |
| 4g. Sign-in after setup without restart | | ✓ | | | | |
| 4h. Installation token from stored App | | ✓ | | | | |
| 4i. No secrets in logs | | ✓ | | | | |
| 4j. Undecryptable App stops start | | ✓ | | | | |
| 4k. Reset keeps App, sign-in journey | | ✓ | | ✓ | | |
| 4l. Setup token required and written | ✓ | | | | | |
| 4m. App inserted elsewhere is seen | | ✓ | | | | |
| 5a. Login event schema | ✓ | | | | | |
| 5b. `login --json` succeeds | | ✓ | | | | |
| 5c. `login --json` failures | | ✓ | | | | |
| 5d. CLI status sent on change | | ✓ | | | | |
| 5e. API stores CLI status | | ✓ | | | | |
| 5f. Runner exit codes | | ✓ | | | | |
| 5g. `--json` prints only events | | ✓ | | | | |
| 6a. Setup token from fragment | ✓ | | | | | |
| 6b. Manifest form posted | | | ✓ | | | |
| 6c. State matched or refused | | | ✓ | | | |
| 6d. Step states | | | ✓ | | | |
| 6e. Loading, failed and stale | | | ✓ | | | |
| 6f. Home card | | | ✓ | | | |
| 6g. Sign-in card before setup | | | ✓ | | | |
| 6h. Screenshots | | | | | ✓ | |
| 7a. `server.env` written once | ✓ | | | | | |
| 7b. Missing keys appended | ✓ | | | | | |
| 7c. Postgres lifecycle | | ✓ | | | | |
| 7d. Other major refused | ✓ | | | | | |
| 7e. Stack starts and stops | | ✓ | | | | |
| 7f. Stop per system | ✓ | | | | | |
| 7g. Login shell `PATH` | | ✓ | | | | |
| 7h. Desktop import boundary | | | | | ✓ | |
| 7i. Running Postgres reused | | ✓ | | | | |
| 7j. Missing database created | | ✓ | | | | |
| 7k. Busy port message | ✓ | ✓ | | | | |
| 7l. Early API exit reported | | ✓ | | | | |
| 7m. No secrets in `desktop.log` | | ✓ | | | | |
| 8a. Navigation policy | ✓ | | | | | |
| 8b. Runner paired by the desktop | | ✓ | | | | |
| 8c. Pairing retry limit | ✓ | | | | | |
| 8d. Login item files | ✓ | | | | | |
| 8e. Update behavior per system | ✓ | | | | | |
| 8f. Hidden start | | | | ✓ | | |
| 8g. Runner restart or re-pair by exit code | ✓ | | | | | |
| 9a. Postgres fetch and hash | ✓ | | | | | |
| 9b. Stage layout | ✓ | | | | | |
| 9c. Installer per system | | | | | ✓ | |
| 9d. Packaged first run | | | | ✓ | | |
| 9e. Draft release assets | | | | | ✓ | |
| 10a. Skills lint | | | | | ✓ | |
| 10b. No old setup terms | | | | | ✓ | |
| C1. Local only | | ✓ | | | | |
| C2. Secrets stay secret | ✓ | ✓ | ✓ | | | |
| C3. Clean stop | | ✓ | | ✓ | | |
| C4. Fast start | | ✓ | | | | |

Unit tests cover the schemas, the loggers, `parseEnv`, `server-env.ts`, the stop branches, the navigation policy, the pairing retry rule, the login item file contents, the update choice per system, and the two scripts with a local HTTP server serving a fixture archive. Electron's `app`, `autoUpdater` and `utilityProcess` are passed in as dependencies so unit tests can use fakes. API integration tests run on real Postgres through template databases and call procedures through the router. GitHub's conversion and token endpoints are mocked with MSW, typed from the real responses. Runner tests use the fake control plane and fake agent. Component tests use Testing Library and MSW for every step state. The desktop stack tests (`test:stack`) run in `desktop.yml` on all three systems, against the fetched Postgres binaries and the step 2 bundles, with Node's `child_process.fork` standing in for `utilityProcess`. They use temp folders and free ports, and sign a user in by running `e2e-session-cli.ts` with the stack's environment. The API test global setup inserts the GitHub App into the template database. The packaged journeys, first run and hidden start, run on Linux under `xvfb-run`. The release check reads the draft release with `gh`.

## Verification

**Automated**

- `pnpm verify`.
- `pnpm skills:lint`.
- `pnpm test:e2e`, for the sign-in journey with the e2e App.
- The CI `bundle` job: `pnpm build` and `node scripts/smoke-server-bundle.mjs` on all three systems.
- `desktop.yml`: `pnpm desktop:build` and `pnpm --filter @plangineer/desktop test:stack` on all four matrix jobs, and `first-run.spec.ts` on Linux.

**Agent checks**

- Screenshot `/get-started` at 1280 px and 375 px in each step 1 state, and with steps 3 and 4 each to do and done (6h). Use `pnpm dev` after `pnpm db:reset`, with the e2e session from `pnpm --filter @plangineer/api e2e:session`, and force the states by intercepting `instance.getStatus`, `runner.list` and `repository.list`.
- Check that `pnpm build` produced the four files in 2a, and that `pnpm desktop:build` produced an installer on each matrix job (9c).
- Check that dependency-cruiser fails a test import from `apps/desktop` into `apps/api` (7h), then revert it.
- Run the 10b search and `pnpm skills:lint`.
- After the first `v*` tag, run `node scripts/release-assets.mjs v<version>` (9e).

**Human checks**

- **The gate, on Windows, macOS and Linux.** The engineer downloads the installer from a draft release built by `desktop.yml` and opens it, passing the unsigned warning as `desktop-app.md` describes. They click **Create GitHub App**, confirm on GitHub, sign in with GitHub, install the App on one repository, and see the Claude Code step done and a repository added, with no terminal. This proves the manifest flow and the GitHub sign-in in the app window against real GitHub, which no test can call.
- The engineer turns the machine off and on and sees the runner online in the Runners screen without opening the window, on each system. This proves the login item itself, which `first-run.spec.ts` cannot.
- The engineer publishes the first draft release once the release check passes.
- The engineer updates their own `.env` once step 1 and step 4 land: add `API_HOST`, `API_LOG_FILE` and `SETUP_TOKEN` and remove the five `GITHUB_APP_*` lines, or delete `.env` and run `pnpm setup:env` again. They then create their dev GitHub App once from the link `pnpm dev` prints.
- The engineer runs `pnpm runner:publish` after this change merges, since the runner's package changes in step 2.

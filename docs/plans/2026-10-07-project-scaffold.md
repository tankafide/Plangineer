# Project scaffold plan

Oct 7, 2026

## Goal

Put every prerequisite for MVP development in place: the machine toolchain, the pnpm workspace with five of its six packages, every check in `pnpm verify`, local Postgres, the agent and git hooks, CI on three systems, and one signed-in slice through every layer that proves the stack works together. MVP features, seed data, MinIO, the fake agent and runner behavior are left out.

## Prerequisites

| Item | Who | Status |
| --- | --- | --- |
| Approve the Windows admin (UAC) prompt when step 1 installs Node 24.21.0 | Engineer | resolved |
| Click "Create GitHub App" on github.com when step 5 opens the manifest page, signed in as `tankafide` | Engineer | resolved |
| Approve, when step 13 asks, pushing `chore/project-scaffold`, opening its pull request and setting branch protection on `main` | Engineer | resolved |

## Steps

The stack, versions and package layout come from [stack decisions](../engineering/stack-decisions.md). Package names are `@plangineer/contracts`, `@plangineer/domain`, `@plangineer/api-client`, `@plangineer/api`, `@plangineer/web` and `plangineer-runner`. Every repo script is `scripts/<kebab-name>.mjs` and follows `tooling-and-infra` and `cross-platform`.

### 1. Machine toolchain

**Files:** none in the repository

The agent prepares this Windows machine. Each command runs from the agent's shell.

| Tool | Now | Action |
| --- | --- | --- |
| Node | 22.13.1 in `C:\Program Files\nodejs` | Download `node-v24.21.0-x64.msi` and `SHASUMS256.txt` from `https://nodejs.org/dist/v24.21.0/`, check the SHA-256, then run `msiexec /i <msi> /passive /norestart`. The engineer approves the download and the UAC prompt |
| pnpm | 10.2.0, installed globally through npm | No action. pnpm 10 switches itself to the `packageManager` version that step 2 pins |
| Docker | Docker Desktop installed per user, engine stopped | Run the machine's Docker startup helper named in the engineer's user-level Claude Code instructions. It starts Desktop through `docker desktop start`, waits for `docker info` and recovers the known stale-socket failure |
| `playwright-cli` | Not installed | `npm install --global @playwright/cli@0.1.22`, used for UI checks per `ui-design-system` |

**Done when:**

- 1a. `node --version` prints `v24.21.0` in a new shell.
- 1b. `docker info` exits 0.
- 1c. `playwright-cli --version` prints `0.1.22`.

### 2. Workspace, TypeScript and the empty packages

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `pnpm-lock.yaml`, `apps/runner/package.json`, `apps/runner/tsconfig.json`, `apps/runner/src/cli.ts`, `apps/runner/src/cli.test.ts`

- **Root `package.json`.** Sets `"packageManager": "pnpm@10.34.6"` and `"engines": { "node": ">=24 <25" }`. It adds `turbo@2.11.7` and `typescript@7.0.2`, and adds the `typecheck` script, which runs `turbo run typecheck`.
- **`pnpm-workspace.yaml`.** Globs are `packages/*` and `apps/*`. It sets `engineStrict: true` and an `allowBuilds` map (Decision D9). No dependency's install script runs, so each package that has one is listed as `false`, with its reason in a YAML comment:

  | Package | Added by | Why its script is not needed |
  | --- | --- | --- |
  | `lefthook` | The root, already | The `prepare` script runs `lefthook install` |
  | `@swc/core` | Step 3 | Its `postinstall` only checks the native binary, and the platform binary arrives as an optional dependency |
  | `esbuild` | Step 7, through `drizzle-kit` | Its platform binary also arrives as an optional dependency |
- **`turbo.json`.** Three tasks.
  - `transit` has `"dependsOn": ["^transit"]` and no command. It exists so a package's cache key includes the source of the packages it imports.
  - `typecheck` has `"dependsOn": ["transit"]` and `"outputs": []`, so a change in `@plangineer/contracts` invalidates the cached typecheck of every package that imports it.
  - `dev` has `"cache": false` and `"persistent": true`.
- **`tsconfig.base.json`.**
  - Every strict flag: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` and `forceConsistentCasingInFileNames`.
  - For Node type stripping (Decision D8): `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `allowImportingTsExtensions` and `noEmit`.
  - Module settings: `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"target": "es2024"`, `"skipLibCheck": true` and `"types": []`.
- **Package setup.**
  - A package is created in the step that adds its first source file, never empty, because `tsc` fails with TS18003 on a package with no inputs.
  - Each package's `package.json` sets `"type": "module"`. Under `"module": "nodenext"`, TypeScript treats a package without it as CommonJS, and `verbatimModuleSyntax` then rejects every `import`, `export` and `import.meta`.
  - Each package's `tsconfig.json` extends the base, adds `"types": ["node"]` where it runs on Node, and has a `typecheck` script that runs `tsc`. A package with `.tsx` files (`packages/api-client` and `apps/web`) also sets `"jsx": "react-jsx"`.
  - Each package declares every dependency it imports, pinned to an exact version. Every package with tests declares `vitest@5.0.3`, and every package that runs on Node declares `@types/node@24.19.1`, both as dev dependencies.
  - Relative imports carry the `.ts` extension.
  - Each package under `packages/` exposes `"exports": { ".": "./src/index.ts" }`, per `architecture-design`.
- **`packages/domain`.** Not created. The first MVP decision creates it with real code. A package with no code cannot pass the checks: `tsc` fails with TS18003 on a package with no inputs, Oxlint's `unicorn/require-module-specifiers` rejects `export {};`, and `unicorn/no-empty-file` rejects an empty file. The dependency-cruiser layout rule for `domain` is already in place.
- **`apps/runner`.** Dev dependencies `execa@10.1.0`, `vitest@5.0.3` and `@types/node@24.19.1`.
  - The package is named `plangineer-runner`, with `"bin": { "plangineer-runner": "./src/cli.ts" }`.
  - `src/cli.ts` prints the package version for `--version` and exits 0.
  - For any other argument, or no argument, it prints `Usage: plangineer-runner --version` to stderr and exits 1.
- **`.gitignore`.** Adds `.env`, `.turbo/`, `apps/web/dist/`, `apps/web/test-results/`, `apps/web/playwright-report/` and `apps/web/blob-report/`.
- **Later packages.** Step 6 creates `packages/contracts`, step 7 creates `apps/api`, step 9 creates `packages/api-client` and step 10 creates `apps/web`.

**Done when:**

- 2a. `pnpm install --frozen-lockfile` succeeds on a fresh clone with Node 24.
- 2b. `pnpm typecheck` passes, and a second run reports every task as a Turborepo cache hit.
- 2c. `node apps/runner/src/cli.ts --version` prints the version from `apps/runner/package.json`, with no build step.
- 2d. `node apps/runner/src/cli.ts` with no argument exits 1 and prints the usage line.

### 3. The checks in `pnpm verify`

**Files:** `package.json`, `scripts/verify.mjs`, `vitest.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`, `.dependency-cruiser.cjs`, `knip.json`, every package's `vitest.config.ts`

- **Dev dependencies.** Root dev dependencies at the versions checked on Oct 7, 2026:

  | Package | Version |
  | --- | --- |
  | `oxlint` | 1.87.0 |
  | `oxlint-tsgolint` | 7.0.2003 |
  | `oxfmt` | 0.72.0 |
  | `dependency-cruiser` | 18.5.0 |
  | `knip` | 6.40.0 |
  | `vitest` | 5.0.3 |
  | `@swc/core` | 1.16.13 |

- **Root scripts.** `format` (`oxfmt`), `format:check` (`oxfmt --check`), `lint` (`oxlint --type-aware --type-check`), `deps:check` (dependency-cruiser over `apps` and `packages`), `knip` and `test` (`vitest run`).
- **`scripts/verify.mjs` order.** The `steps` list runs, fastest first: format check, skills mirror check, Oxlint, typecheck, dependency-cruiser, Knip, then Vitest. Each step finds its CLI's JavaScript bin with `binPath`, as the script does today. The typecheck step runs Turborepo's bin with `run typecheck`.
- **`.oxlintrc.json`.**
  - Plugins: `typescript`, `unicorn`, `import`, `react`, `jsx-a11y` and `vitest`.
  - Categories: `correctness` and `suspicious` are errors.
  - Rules:
    - `import/no-cycle` is an error.
    - `max-lines` is `["error", 300]`.
    - `no-console` is an error, with an override that allows it in `scripts/**` and `apps/runner/src/cli.ts`.
    - `no-restricted-imports` bans `@radix-ui/*`, `radix-ui`, `vaul` and `@base-ui-components/react`, with the message "Use @base-ui/react through shadcn/ui".
  - `ignorePatterns`: `apps/web/src/routeTree.gen.ts` and `apps/api/drizzle/**`, which are generated.
- **`.oxfmtrc.json`.** Single quotes, LF endings and a print width of 100. The existing `scripts/*.mjs` files keep that style.
  - Oxfmt formats code and config only (Decision D19). `ignorePatterns`: `**/*.md`, `.claude/skills/**`, `apps/web/src/routeTree.gen.ts` and `apps/api/drizzle/**`.
  - Oxfmt already skips lockfiles and whatever `.gitignore` lists.
- **`.dependency-cruiser.cjs`.**
  - Sets `options.parser: 'swc'`. dependency-cruiser 18.5.0 supports only TypeScript below 7 for parsing, and TypeScript 7 ships no compiler API (Decision D20). `@swc/core` parses `.ts` and `.tsx`.
  - Encodes the stack's package layout table as one `forbidden` rule per package. The rules restrict imports between workspace packages (`@plangineer/*` and `apps/*`) only. npm packages are governed by each package's declared dependencies, not by these rules.
  - Adds `no-circular`, and a rule that forbids a relative import (dependency type `local`) whose resolved path lies inside another workspace package. Imports through a package name (`aliased-workspace`) stay allowed, because each package's `exports` entry points at its own `src/index.ts`.
  - Each rule's `comment` names what to import instead, such as "domain may import only @plangineer/contracts. Move this code to the app that needs it."
- **`knip.json`.**
  - One entry per workspace.
  - The root workspace lists `scripts/*.mjs` as entries.
  - `apps/api` lists `src/main.ts`, `src/db/reset.ts`, `src/db/migrate-cli.ts`, `src/auth/auth-cli.ts` and `drizzle.config.ts`.
  - `apps/runner` lists `src/cli.ts`.
  - Unused files, exports and dependencies are errors. The only ignore entry is `ignoreDependencies: ["@swc/core"]`, because dependency-cruiser loads it at runtime and nothing imports it (Decision D20).
- **Vitest projects.** The root `vitest.config.ts` sets `test.projects` to an inline `scripts` project (`scripts/**/*.test.mjs`) plus `packages/*` and `apps/*`. Each package's own `vitest.config.ts` sets its environment.

**Done when:**

- 3a. `pnpm verify` passes and runs all seven steps in the order above.
- 3b. A file with a format break, a lint error, a type error, a layout violation, an unused export or a failing test each makes `pnpm verify` fail, naming the step and the file.
- 3c. A temporary `packages/domain/src/index.ts` that imports `apps/runner/src/cli.ts` fails dependency-cruiser with the domain rule's `comment` in the output. This proves the `swc` parser reads `.ts` files before any later step relies on it.

### 4. Local Postgres and the environment file

**Files:** `compose.yaml`, `.env.example`, `scripts/db-up.mjs`, `scripts/setup-env.mjs`, `scripts/setup-env.test.mjs`, `scripts/env-file.mjs`, `scripts/env-file.test.mjs`, `package.json`

- **Root dev dependency.** `execa@10.1.0`, which every repo script uses to spawn a CLI.
- **`compose.yaml`.** One service, `postgres`, on image `postgres:18.6-alpine`.
  - Settings: `POSTGRES_USER=plangineer`, `POSTGRES_PASSWORD=plangineer`, `POSTGRES_DB=plangineer`, port `5432:5432` and the named volume `postgres-data`.
  - Healthcheck: `pg_isready -U plangineer -d plangineer` every 2 seconds.
- **`scripts/db-up.mjs`** (`pnpm db:up`).
  - Runs `docker info` through execa. If it fails, the script exits 1 with "Docker is not running. Start Docker Desktop, then rerun pnpm db:up."
  - Otherwise it runs `docker compose up --wait postgres`.
  - It exports `startPostgres()` for step 11's `scripts/dev.mjs`.
- **`.env.example`.** Lists every variable with a local value or a placeholder, grouped by app with one comment line per group:

  | Variable | Example value | Parsed by |
  | --- | --- | --- |
  | `DATABASE_URL` | `postgres://plangineer:plangineer@localhost:5432/plangineer` | api |
  | `API_PORT` | `3000` | api, web |
  | `LOG_LEVEL` | `info` | api |
  | `BETTER_AUTH_SECRET` | `replace-with-32-or-more-random-characters` | api |
  | `BETTER_AUTH_URL` | `http://localhost:5173` | api |
  | `GITHUB_APP_ID` | `replace-me` | none yet, written by step 5 for the GitHub integration |
  | `GITHUB_APP_CLIENT_ID` | `replace-me` | api |
  | `GITHUB_APP_CLIENT_SECRET` | `replace-me` | api |
  | `GITHUB_APP_PRIVATE_KEY` | `replace-me` | none yet, written by step 5 for the GitHub integration |

- **`scripts/env-file.mjs`.** Exports `setEnvValues(text, values)`, which replaces or appends `KEY=value` lines and returns the new text with LF endings. It writes a value that holds a newline as a double-quoted string with `\n` escapes. Node's `util.parseEnv` reads that string back unchanged.
- **`scripts/setup-env.mjs`** (`pnpm setup:env`).
  - If `.env` exists, the script exits 1 with "`.env` already exists. Delete it to start over."
  - Otherwise it copies `.env.example` to `.env` and sets `BETTER_AUTH_SECRET` to `randomBytes(32).toString('base64url')`.

**Done when:**

- 4a. `pnpm db:up` starts Postgres 18.6, and returns only once the healthcheck passes.
- 4b. `pnpm db:up` with Docker stopped exits 1 with the Docker message.
- 4c. `pnpm setup:env` creates `.env` with a 43-character `BETTER_AUTH_SECRET`, and refuses to run a second time.
- 4d. `setEnvValues` round-trips a multi-line PEM value through `util.parseEnv`, and replaces an existing key in place.

### 5. Dev GitHub App through the manifest flow

**Files:** `scripts/setup-github-app.mjs`, `scripts/github-app-manifest.mjs`, `scripts/github-app-manifest.test.mjs`, `scripts/github-app-callback.mjs`, `scripts/github-app-callback.test.mjs`, `package.json`

`pnpm setup:github-app` creates the dev GitHub App with one click from the engineer, and writes its credentials straight into `.env`. The agent never reads or prints the values.

1. The script exits 1 if `.env` is missing, with "Run pnpm setup:env first."
2. It listens on `127.0.0.1` port `0` and creates a random `state` with `randomBytes(16).toString('hex')`.
3. It opens `http://127.0.0.1:<port>/` with the `open` package (11.0.4). That page auto-submits a form to `https://github.com/settings/apps/new?state=<state>`. The form's `manifest` field holds the manifest below.
4. The engineer clicks "Create GitHub App". GitHub redirects to `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`.
5. The script passes the callback's query to `checkCallback(query, expectedState)` from `scripts/github-app-callback.mjs`. The function returns `{ ok: true, code }`, or `{ ok: false, status: 400, message }` for a missing `code` or a mismatched `state`. On `ok: false` the script answers with that status and message, writes nothing and exits 1. Otherwise it calls `POST https://api.github.com/app-manifests/<code>/conversions`.
6. With `setEnvValues` it writes `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY` (the `pem` field) to `.env`.
7. The browser page reads "Plangineer dev app created. You can close this tab." The script prints the app's `html_url` and exits 0.
8. If the conversion fails, the script prints GitHub's status and message, then exits 1.

`scripts/github-app-manifest.mjs` exports `buildManifest(redirectUrl)` and returns:

| Field | Value |
| --- | --- |
| `name` | `plangineer-dev-<6 random hex characters>` (app names are unique across GitHub) |
| `url` | `https://github.com/tankafide/Plangineer` |
| `redirect_url` | The script's `/callback` URL |
| `callback_urls` | `["http://localhost:5173/api/auth/callback/github"]` |
| `public` | `false` |
| `hook_attributes` | `{ "url": "https://example.com/plangineer-dev-webhook", "active": false }` |
| `default_permissions` | `contents: write`, `pull_requests: write`, `checks: read`, `metadata: read`, `emails: read` |
| `default_events` | `[]` |

This step is the first to run GitHub's manifest flow, so it proves the field names above. GitHub rejected `email_addresses`, the REST API's name for this permission, with "Default permission records resource is not included in the list". The manifest takes the internal name `emails`.

**Done when:**

- 5a. `buildManifest` returns the fields above, with a redirect URL on `127.0.0.1`.
- 5b. After the engineer's click, `.env` holds non-placeholder values for the four `GITHUB_APP_*` variables, and `GET https://api.github.com/apps/<slug>` returns the new app.
- 5c. `checkCallback` returns status 400 for a wrong `state` and for a missing `code`, and returns the code for a matching `state`.

### 6. Contracts: the base and `me.get`

**Files:** `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/base.ts`, `packages/contracts/src/me.ts`, `packages/contracts/src/me.test.ts`

- **Dependencies.** `zod@4.6.5` and `@orpc/contract@1.15.5`. Dev dependency `vitest@5.0.3`.
- **`base.ts`.** Exports `base = oc.errors({...})` with `UNAUTHORIZED` (401), `FORBIDDEN` (403) and `INPUT_VALIDATION_FAILED` (422). The `INPUT_VALIDATION_FAILED` data is `{ formErrors: string[], fieldErrors: Record<string, string[]> }`, per `api-contract-design`.
- **`me.ts`.** Exports:
  - `UserRole = z.enum(['admin', 'member'])`.
  - `MeGetOutput = z.object({ id: z.uuid(), name: z.string(), email: z.email(), role: UserRole })`. Outputs use `z.object`, which strips unknown keys, per `api-contract-design`.
  - `meGet = base.route({ method: 'GET', path: '/me' }).output(MeGetOutput)`.
- **`index.ts`.** Exports `contract = { me: { get: meGet } }` plus the schemas.

**Done when:**

- 6a. `MeGetOutput` accepts a valid user, rejects an unknown role and a non-uuid id, and strips an unknown key.

### 7. API foundation: environment, logging, database and test databases

**Files:**

- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/drizzle.config.ts`
- `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `apps/api/src/logger.ts`
- `apps/api/src/db/client.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/reset.ts`, `apps/api/src/db/reset.test.ts`, `apps/api/src/db/reset-database.ts`, `apps/api/src/db/local-host.ts`, `apps/api/src/db/local-host.test.ts`
- `package.json`

- **Dependencies.**

  | Package | Version | Kind |
  | --- | --- | --- |
  | `zod` | 4.6.5 | dependency |
  | `pino` | 10.4.0 | dependency |
  | `pg` | 8.23.1 | dependency |
  | `drizzle-orm` | 0.45.3 | dependency |
  | `drizzle-kit` | 0.31.11 | dev |
  | `@types/pg` | 8.23.1 | dev |
  | `@types/node` | 24.19.1 | dev |
  | `vitest` | 5.0.3 | dev |

- **`env.ts`.** Exports `parseEnv(source: Record<string, string | undefined>)`.
  - Schema: `DATABASE_URL`, `API_PORT`, `LOG_LEVEL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`.
  - Value rules:
    - `API_PORT` is an integer from 1 to 65535, parsed from a string without `z.coerce`.
    - `LOG_LEVEL` is a pino level.
    - `BETTER_AUTH_SECRET` is at least 32 characters.
    - Both URLs are `z.url()`.
  - There are no defaults.
  - On failure it throws an error that lists every missing or invalid variable. `main.ts` catches it, logs it through `createLogger('error')` with a fixed level, because `LOG_LEVEL` may be the invalid variable, and exits 1.
  - Each entry point (`main.ts`, `db/reset.ts`, `db/migrate-cli.ts`, `auth/auth-cli.ts` and `test/global-setup.ts`) calls `parseEnv(process.env)` once and passes the result down, per `api-server`. No other module reads `process.env`. Apps load `.env` with Node's `--env-file=../../.env` flag in their scripts.
- **`logger.ts`.** Exports `createLogger(level)`.
  - One pino logger with `pino.transport({ targets })` that writes to stdout and to `pino/file` at `logs/api.log`, with `mkdir: true`. The path is built from the repository root with `node:path`.
  - `redact.paths` covers `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.token`, `*.secret` and `*.clientSecret`.
- **`db/client.ts`.** Exports `createDatabase(url)`, which returns `{ db, pool }` from a `pg` `Pool` and `drizzle(pool, { schema, casing: 'snake_case' })`.
- **`drizzle.config.ts`.** Sets `dialect: 'postgresql'`, `schema: './src/db/schema.ts'`, `out: './drizzle'` and `casing: 'snake_case'`, with no credentials. Migrations come only from `pnpm --filter @plangineer/api db:generate` (`drizzle-kit generate`). Decision D5 covers why.
- **`db/schema.ts`.** Holds the Better Auth tables that step 8 generates. Step 7 starts with no tables and no migrations folder, so nothing in step 7 runs a migration.
- **`db/migrate.ts`.** Exports `migrateDatabase(db)`, which runs Drizzle's `migrate` with the migrations folder resolved through `fileURLToPath`. Drizzle's migrator throws when `drizzle/meta/_journal.json` is missing, so the first call runs in step 8, after the first migration exists.
- **`db/local-host.ts`.** Exports `isLocalDatabaseUrl(url)`, true only for the hosts `localhost`, `127.0.0.1` and `::1`.
- **`db/reset.ts`** (`pnpm db:reset`, root script `pnpm --filter @plangineer/api db:reset`).
  - Parses the environment and refuses a non-local `DATABASE_URL` with exit 1.
  - Otherwise calls `resetDatabase(env.DATABASE_URL, logger)` and exits 0.
- **`db/reset-database.ts`.** Exports `resetDatabase(url, logger)`. It connects to the `postgres` maintenance database on the same server, runs `DROP DATABASE IF EXISTS <name> WITH (FORCE)` and `CREATE DATABASE <name>`, migrates the new database and logs "Database reset". There is no seed yet (Decision D7).
  - Step 7 tests only the refusal (7c), which returns before any connection. Step 8 tests `resetDatabase` against a cloned test database (8h), never against `DATABASE_URL`, so `pnpm verify` never touches the dev database.

**Done when:**

- 7a. `parseEnv` returns a typed object for a valid source, and throws one error naming every missing or invalid variable for a bad one.
- 7b. `isLocalDatabaseUrl` is true for the three local hosts and false for any other host.
- 7c. `pnpm db:reset` refuses a `DATABASE_URL` on host `db.example.com` with exit 1, and leaves the database untouched.

### 8. API: Better Auth, the oRPC router and the server

**Files:**

- `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/`, `apps/api/src/db/migrate-cli.ts`
- `apps/api/src/auth/auth.ts`, `apps/api/src/auth/auth-cli.ts`, `apps/api/src/auth/auth.test.ts`
- `apps/api/src/test/global-setup.ts`, `apps/api/src/test/test-database.ts`, `apps/api/src/db/reset-database.test.ts`
- `apps/api/src/rpc/context.ts`, `apps/api/src/rpc/router.ts`, `apps/api/src/rpc/router.test.ts`
- `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/main.ts`

- **Dependencies.** `better-auth@1.7.7`, `hono@4.13.13`, `@hono/node-server@2.1.3`, `@orpc/server@1.15.5` and `@plangineer/contracts` (`workspace:*`).
- **`auth/auth.ts`.** Exports `createAuth({ db, env })`, which configures Better Auth:
  - `database: drizzleAdapter(db, { provider: 'pg', schema })`.
  - `baseURL: env.BETTER_AUTH_URL`, `secret: env.BETTER_AUTH_SECRET` and `trustedOrigins: [env.BETTER_AUTH_URL]`.
  - `socialProviders.github` with the two `GITHUB_APP_CLIENT_*` values.
  - `advanced.database.generateId: 'uuid'` and `account.encryptOAuthTokens: true`.
  - `user.additionalFields.role: { type: 'string', input: false, defaultValue: 'member' }`.
  - No `session.cookieCache`, plugins, `disableCSRFCheck` or `disableOriginCheck`.
- **`auth/auth-cli.ts`.** The config file for Better Auth's CLI only. The CLI needs a module that exports a ready instance named `auth`, and `auth.ts` exports a factory. The file loads the repository's `.env` with `process.loadEnvFile`, using a path built with `fileURLToPath`. It then exports `auth = createAuth({ db: createDatabase(env.DATABASE_URL).db, env })`, where `env = parseEnv(process.env)`. The CLI never connects to the database for `generate`.
- **Better Auth tables.**
  1. In `apps/api`, run `pnpm dlx auth@1.7.7 generate --config src/auth/auth-cli.ts --output src/db/schema.ts`.
  2. Change every id default to ``sql`uuidv7()` ``.
  3. Change every `timestamp(...)` column to `timestamp(..., { withTimezone: true })`, per `data-model-design`. The generator emits timestamps without a time zone.
  4. Make `user.role` a `pgEnum('user_role', UserRole.options)` with default `'member'`, importing `UserRole` from `@plangineer/contracts`.
  5. Run `pnpm --filter @plangineer/api db:generate` for the first migration.
  6. Never run Better Auth's `migrate`.

  The generator's columns are kept as it emits them, with the edits above. The tables and the constraints the scaffold relies on:

  | Table | Columns the scaffold uses | Constraints |
  | --- | --- | --- |
  | `user` | `id`, `name`, `email`, `email_verified`, `image`, `role`, `created_at`, `updated_at` | `id` uuid default `uuidv7()`; `email` unique; `role` is `user_role` default `'member'` |
  | `session` | `id`, `user_id`, `token`, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at` | `token` unique; `user_id` references `user.id` on delete cascade |
  | `account` | `id`, `user_id`, `account_id`, `provider_id`, the token columns, `created_at`, `updated_at` | `user_id` references `user.id` on delete cascade |
  | `verification` | `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at` | none beyond the primary key |

- **`db/migrate-cli.ts`.** Parses the environment, creates the database, calls `migrateDatabase` and ends the pool. `apps/api` adds the `db:migrate` script that runs it.
- **Test databases** (`persistence` and `testing`). These arrive here because they migrate, and the first migration exists only from this step.
  - **`test/global-setup.ts`.** A Vitest `globalSetup`, set in `apps/api/vitest.config.ts`. It reads `.env` with `util.parseEnv`, without loading it into `process.env`, which every Vitest project shares, and calls `parseEnv` on the result. It picks a prefix unique to the run, `plangineer_test_<8 hex>`, creates and migrates the run's template `<prefix>_template`, and closes every connection. Teardown drops the run's template and fails on any `<prefix>_*` database left behind. The unique prefix keeps two concurrent runs on one Postgres server from breaking each other.
  - **`test/test-database.ts`.** Exports `createTestDatabase()`. The function clones `<prefix>_<uuid without dashes>` from the run's template and returns `{ db, pool, url, drop }`. `drop` ends the pool, then drops the database. Each test file creates one in `beforeAll` and drops it in `afterAll`.
- **`rpc/context.ts`.** Defines `InitialContext = { logger: Logger, session: { user: { id, name, email, role } } | null }`.
- **`rpc/router.ts`.**
  - Exports `router = implement(contract).$context<InitialContext>().router(...)`.
  - An `authed` middleware throws the contract's `UNAUTHORIZED` when `session` is null.
  - `me.get` returns the session user mapped to `MeGetOutput`, and parses `role` with `UserRole`.
- **`app.ts`.** Exports `createApp({ auth, logger })`, a Hono app that wires, in order:
  1. A request id and a child logger per request.
  2. Hono's `bodyLimit` middleware on `/api/*` and `/rpc/*`, with `maxSize: 1024 * 1024` (1 MiB). A larger body gets status 413 before any parsing, per `security`.
  3. `app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))`.
  4. An `RPCHandler` from `@orpc/server/fetch` at `/rpc/*` with `prefix: '/rpc'`. It uses `SimpleCsrfProtectionHandlerPlugin` and an `onError` interceptor that logs. Its context resolves `session` with `auth.api.getSession({ headers })`.
  5. `app.onError`, which logs and returns 500.
- **`main.ts`.**
  - Parses the environment, creates the database, auth, logger and app, then serves on `API_PORT`.
  - On `SIGINT` or `SIGTERM` it closes the server, ends the pool and exits 0.
  - Scripts: `dev` is `node --env-file=../../.env --watch src/main.ts`, and `start` is `node --env-file=../../.env src/main.ts`.

**Done when:**

- 8a. A user created through Better Auth's adapter (`(await auth.$context).internalAdapter.createUser`) gets a version 7 UUID id from Postgres and the role `member`.
- 8b. `me.get` called through the router with no session throws `UNAUTHORIZED`.
- 8c. `me.get` called with a session for a stored user returns that user's id, name, email and role.
- 8d. `GET /api/auth/ok` through `app.request()` returns 200.
- 8e. `POST /api/auth/sign-in/social` with `{ "provider": "github" }` and an allowed `Origin` returns a URL on `https://github.com/login/oauth/authorize` that carries the configured client id.
- 8f. `POST /rpc/me/get` without the CSRF header the plugin requires is rejected.
- 8g. `pnpm --filter @plangineer/api start` with a variable missing from `.env` exits 1 and names the variable.
- 8h. `resetDatabase` run against the URL of a database from `createTestDatabase()` drops it, recreates it and leaves every migration applied.
- 8i. Two test files that run in parallel each get their own cloned database, no database with the run's prefix remains after the run, and two concurrent runs both pass.
- 8j. A `POST /rpc/me/get` with a body over 1 MiB gets status 413.
- 8k. `POST /rpc/me/get` through `app.request()` with the session cookie Better Auth issues for a stored user returns that user. Without a cookie it returns 401.
- 8l. `POST /api/auth/update-user` with `{ "role": "admin" }` and a valid session leaves the user's role `member`, per `auth-and-access`.

### 9. API client

**Files:** `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/vitest.config.ts`, `packages/api-client/src/index.ts`, `packages/api-client/src/api-provider.tsx`, `packages/api-client/src/me.ts`, `packages/api-client/src/me.test.tsx`, `packages/api-client/src/query-client.ts`, `packages/api-client/src/query-client.test.ts`

- **Dependencies.** `@orpc/client@1.15.5`, `@orpc/contract@1.15.5`, `@orpc/tanstack-query@1.15.5`, `@tanstack/react-query@5.104.1` and `@plangineer/contracts` (`workspace:*`). `react@19.3.0` is a peer dependency. Dev dependencies: `react@19.3.0`, `react-dom@19.3.0`, `@types/react@19.3.0`, `msw@3.0.2`, `vitest@5.0.3`, `jsdom@30.1.2` and `@testing-library/react@16.3.3`.
- **`api-provider.tsx`.** Exports `ApiProvider({ url, children })`. The component builds the utils once: an `RPCLink` to `url` with `SimpleCsrfProtectionLinkPlugin` and `ResponseValidationPlugin(contract)` from `@orpc/contract/plugins`, wrapped with `createTanstackQueryUtils(createORPCClient(link))`. It provides the utils through a React context that only this package reads.
- **`me.ts`.** Exports `useMe()`, which returns `useQuery(utils.me.get.queryOptions())`. Components use this hook and never see oRPC or a query key, per `frontend-data`.
- **`query-client.ts`.** Exports `createQueryClient()`.
  - Queries retry a network failure or a 5xx at most twice.
  - Queries never retry a 4xx or a contract-defined error.
  - Mutations never retry.
- **Tests.** Hook tests render `useMe` inside `ApiProvider` and a `QueryClientProvider` on jsdom, with MSW and a fresh `QueryClient` per test.

**Done when:**

- 9a. `useMe` fetches `/rpc/me/get` and resolves to the parsed user.
- 9b. A response that breaks `MeGetOutput` rejects with a validation error.
- 9c. A query retries a 503 twice, then fails. It does not retry a 401.

### 10. Web app: shell, theme, sign-in and the account summary

**Files:**

- `apps/web/package.json`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/components.json`
- `apps/web/src/main.tsx`, `apps/web/src/routeTree.gen.ts`, `apps/web/src/styles/theme.css`
- `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/routes/sign-in.tsx`
- `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/cn.ts`
- `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/card.tsx`, `apps/web/src/components/ui/skeleton.tsx`, `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/features/auth/sign-in-card.tsx`, `apps/web/src/features/auth/sign-in-card.test.tsx`
- `apps/web/src/features/account/account-summary.tsx`, `apps/web/src/features/account/account-summary.test.tsx`
- `apps/web/src/test/setup.ts`

- **Create the app.**
  1. Run `pnpm dlx shadcn@4.21.4 create` in `apps/web`, choosing Vite, Base UI, Nova, Lucide and Geist.
  2. Reshape the output to this repository: drop any ESLint or Prettier files, set the package name to `@plangineer/web` and extend `tsconfig.base.json`.
  3. Pin the template's React packages and add the stack's packages: `react@19.3.0`, `react-dom@19.3.0`, `zod@4.6.5`, `vite@8.3.3`, `@vitejs/plugin-react@6.1.2`, `@tanstack/react-router@1.170.41`, `@tanstack/router-plugin@1.168.42`, `@tanstack/react-query@5.104.1`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`, `@base-ui/react@1.8.0`, `lucide-react@1.52.0`, `class-variance-authority@0.7.1`, `@fontsource-variable/geist@5.3.0`, `@fontsource-variable/geist-mono@5.3.0`, `better-auth@1.7.7`, `@plangineer/api-client` and `@plangineer/contracts`.
  4. Add the dev dependencies `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@24.19.1`, `vitest@5.0.3`, `@testing-library/react@16.3.3`, `@testing-library/user-event@14.6.7`, `jsdom@30.1.2` and `msw@3.0.2`.
- **Theme** (`visual-style`).
  - `components.json` has style `base-nova`, and `aliases.utils` set to `@/lib/cn`, since `lib/utils.ts` becomes `lib/cn.ts`.
  - `src/styles/theme.css` takes its color variables from `.agents/skills/visual-style/assets/theme.css`. It keeps the generated `@custom-variant dark` and `@theme inline` mappings, and adds `--color-link`, `--color-destructive-foreground` and `success`, `warning` and `info` with their foregrounds.
  - No `chart-*` variables.
  - `index.html` sets `class="dark"` on `<html>` and has an inline script that applies the stored mode before first paint.
- **`tsconfig.json`.** Overrides the base with `"module": "esnext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, DOM libs, `"types": ["vite/client"]` and `"paths": { "@/*": ["./src/*"] }`, the alias the shadcn components import through.
- **`vite.config.ts`.**
  - Plugins: TanStack Router with `autoCodeSplitting: true`, React and Tailwind.
  - `resolve.alias` maps `@` to `src`, through `fileURLToPath`.
  - The dev server runs on port `5173` with `strictPort: true`.
  - `/api` and `/rpc` proxy to `http://localhost:<API_PORT>` (Decision D6). `API_PORT` comes from the root `.env` through Vite's `loadEnv`, parsed by a one-field Zod schema.
- **`vitest.config.ts`.** Environment `jsdom`, setup file `src/test/setup.ts`, the same `@` alias as `vite.config.ts` (Vitest does not read `vite.config.ts` when it has its own config), and `include: ['src/**/*.test.{ts,tsx}']`, so Vitest never picks up the Playwright specs in `e2e/`.
- **Routes.**
  - `__root.tsx` sets `notFoundComponent` and `errorComponent`.
  - `index.tsx` checks `authClient.getSession()` in `beforeLoad` and redirects to `/sign-in` when there is no session.
  - `sign-in.tsx` redirects to `/` when there is a session.
- **`lib/auth-client.ts`.** Exports `authClient = createAuthClient()` from `better-auth/react`, on the page's own origin.
- **`lib/api.ts`.** Exports the app's `queryClient = createQueryClient()` and `apiUrl = \`${window.location.origin}/rpc\``. `main.tsx` wraps the router in `QueryClientProvider` and `ApiProvider`.
- **`SignInCard`.** A card titled "Sign in to Plangineer" with a "Sign in with GitHub" button. The button calls `authClient.signIn.social({ provider: 'github', callbackURL: '/', errorCallbackURL: '/sign-in' })`.
  - Without `errorCallbackURL`, Better Auth sends an OAuth error to its own `/api/auth/error` page, outside the app.
  - `sign-in.tsx` reads the `error` search parameter. When it is present, the card shows an `Alert` above the button: "GitHub sign-in did not complete. Try again." The button stays as the retry.
- **`AccountSummary`.** Reads `useMe()` and shows the user's name, email and role with a "Sign out" button.
  - Sign out calls `authClient.signOut()`, clears the query cache with `queryClient.clear()` and navigates to `/sign-in`.
  - It renders four of the five states from `frontend-react`:

  | State | What it shows |
  | --- | --- |
  | Loading | A skeleton |
  | Failed | The error and a Retry button |
  | Stale | The user, marked stale, when a refetch fails |
  | Ready | The user |

  It has no empty state, because a signed-in user always exists.
- **Layout** (`ui-design-system`, phone first).

  | Screen | At 375 px | From 768 px |
  | --- | --- | --- |
  | `/sign-in` | One column. The card spans the width inside a 16 px gutter, centered vertically, with a full-width button | The card is centered at a maximum width of 400 px |
  | `/` | One column. The account card spans the width inside a 16 px gutter. Name, email and role stack, and Sign out is full width below them | The card is centered at a maximum width of 640 px. Sign out sits at the right of the card footer |

**Done when:**

- 10a. `SignInCard` renders the "Sign in with GitHub" button, and clicking it calls the social sign-in with provider `github` and `errorCallbackURL` `/sign-in`.
- 10g. With an `error` search parameter, the sign-in page shows the alert above the GitHub button.
- 10b. `AccountSummary` renders the skeleton, failed, stale and ready states, each found by role or label.
- 10c. Clicking Retry in the failed state refetches and shows the user.
- 10f. Clicking Sign out calls the sign-out endpoint, clears the cached user and lands on `/sign-in`.
- 10d. `pnpm --filter @plangineer/web exec vite build` completes with no errors.
- 10e. At 1280 px and 375 px, `playwright-cli` screenshots show the sign-in page and the account summary's ready, failed and stale states matching the layout table, with no horizontal scroll and every control visible.

### 11. `pnpm dev` and the end-to-end journey

**Files:** `scripts/dev.mjs`, `scripts/test-e2e.mjs`, `package.json`, `apps/web/playwright.config.ts`, `apps/web/e2e/sign-in.spec.ts`, `apps/web/package.json`

- **`scripts/dev.mjs`** (`pnpm dev`). Calls `startPostgres()` from `scripts/db-up.mjs`, runs `pnpm --filter @plangineer/api db:migrate`, then runs Turborepo's bin with `run dev --filter=@plangineer/api --filter=@plangineer/web`. It spawns everything with execa.
- **Migrate script.** The root `package.json` adds `db:migrate`, which runs `pnpm --filter @plangineer/api db:migrate` (step 8).
- **`apps/web/playwright.config.ts`.**
  - Dev dependency `@playwright/test@1.63.0`.
  - Projects: `desktop-chromium` (1280 x 800) and `phone` (Chromium at 375 x 812, `isMobile: true`).
  - Settings: `trace: 'retain-on-failure'`, and the `html` reporter with `open: 'never'`.
  - The config loads the root `.env` with `process.loadEnvFile` and parses `API_PORT` with the same one-field Zod schema as `vite.config.ts`.
  - `webServer` starts the API with `pnpm --filter @plangineer/api start` and waits for `http://localhost:<API_PORT>/api/auth/ok`. It also starts the web app with `pnpm --filter @plangineer/web dev` and waits for `http://localhost:5173`.
- **`scripts/test-e2e.mjs`** (`pnpm test:e2e`).
  - First checks that ports `5173` and `API_PORT` are free. If either is in use, it exits 1 with "Stop pnpm dev before running pnpm test:e2e." and touches nothing, because the reset would otherwise drop a running dev API's connections.
  - Then runs `pnpm db:reset`, then the Playwright Test bin with the web app's config.
- **`e2e/sign-in.spec.ts`.** A signed-out visit to `/` lands on `/sign-in` and shows the GitHub button. Clicking the button sends a request to `https://github.com/login/oauth/authorize` with the client id. The spec intercepts that request with `page.route` and aborts it, so no real GitHub call is made.

**Done when:**

- 11a. `pnpm dev` starts Postgres, applies migrations and serves the web app on `http://localhost:5173`, with the API reachable through its proxy.
- 11c. `pnpm db:migrate` from the repository root applies pending migrations and exits 0.
- 11d. With `pnpm dev` running, `pnpm test:e2e` exits 1 with the "Stop pnpm dev" message, and the dev database is untouched.
- 11b. `pnpm test:e2e` passes the sign-in journey in both the `desktop-chromium` and `phone` projects.

### 12. Agent and git hooks

**Files:** `.claude/settings.json`, `scripts/claude-post-edit.mjs`, `scripts/claude-stop.mjs`, `scripts/claude-hooks.mjs`, `scripts/claude-hooks.test.mjs`, `lefthook.yml`

The "day one" guardrails from [tech stack](../engineering/tech-stack.md) apply here.

- **`.claude/settings.json`.** Registers two hooks:
  - `PostToolUse` with matcher `Edit|Write` runs `node "${CLAUDE_PROJECT_DIR}/scripts/claude-post-edit.mjs"`.
  - `Stop` runs `node "${CLAUDE_PROJECT_DIR}/scripts/claude-stop.mjs"`.
  - Hooks run in the session's current directory, and only exit code 2 blocks. A relative path would fail with "Cannot find module" after the agent changes directory, and the guardrail would silently stop.
- **`scripts/claude-hooks.mjs`.** Exports two pure functions:
  - `lintTargets(filePath)` returns the path when it ends in `.ts`, `.tsx`, `.mjs`, `.cjs` or `.json`, and returns nothing otherwise.
  - `shouldRunVerify({ stopHookActive, changedPaths })` returns false when `stopHookActive` is true, or when every changed path is under `docs/`.
- **`claude-post-edit.mjs`.** Reads the hook JSON from stdin. For a lint target it runs `oxfmt --check` and `oxlint` on that one file. On failure it writes their output to stderr and exits 2, so Claude Code feeds the output back to the agent. The script never rewrites the file.
- **`claude-stop.mjs`.**
  - Reads the hook JSON from stdin and takes the changed paths from `git status --porcelain`.
  - When `shouldRunVerify` is true, it runs `scripts/verify.mjs`.
  - On failure it writes the failing step and the last 40 lines of output to stderr, then exits 2.
- **`lefthook.yml`.** Adds a `pre-push` command, `verify`, that runs `node scripts/verify.mjs`.

**Done when:**

- 12a. `lintTargets` and `shouldRunVerify` return the values above for each case: a stop that is already active, docs-only changes, code changes, and each file extension.
- 12b. An edit that leaves a lint error in a `.ts` file makes the PostToolUse hook exit 2 with the Oxlint message.
- 12e. Both hooks run the same way when the session's current directory is `apps/api`.
- 12c. Ending a turn with a failing test in the working tree makes the Stop hook exit 2, naming the Vitest step.
- 12d. `git push` runs `pnpm verify` first, and stops the push when the verify fails.

### 13. CI

**Files:** `.github/workflows/ci.yml`

- **Triggers.** The workflow runs on `pull_request` and on `push` to `main`. It sets `permissions: contents: read`, and a `concurrency` group of `ci-${{ github.ref }}` with `cancel-in-progress: true` for pull requests.
- **`verify` job.** Runs on a matrix of `ubuntu-latest`, `macos-latest` and `windows-latest`, with `fail-fast: false`. Steps:
  1. `actions/checkout@v7`.
  2. `pnpm/action-setup@v6`, with no `version` input.
  3. `actions/setup-node@v7`, with `node-version: 24` and `cache: pnpm`.
  4. `ikalnytskyi/action-setup-postgres@v8`, with `username: plangineer`, `password: plangineer`, `database: plangineer` and `postgres-version: "18"`.
  5. `node --eval "require('node:fs').copyFileSync('.env.example', '.env')"`.
  6. `pnpm install --frozen-lockfile`.
  7. `pnpm verify`.
- **`e2e` job.** Runs on `ubuntu-latest` with steps 1 to 6 above. It then runs `pnpm --filter @plangineer/web exec playwright install --with-deps chromium` and `pnpm test:e2e`. When the job fails, `actions/upload-artifact@v7` uploads `apps/web/playwright-report/` and `apps/web/test-results/` as `playwright-report`.
- **Push and pull request.** Per `git-workflow`, the agent asks the engineer before pushing `chore/project-scaffold` and opening its pull request (Prerequisites).
- **Branch protection.** After the first green run, and with the engineer's approval from Prerequisites, the agent runs `gh api --method PUT repos/tankafide/Plangineer/branches/main/protection --input <file>` with this body:

  ```json
  {
    "required_status_checks": {
      "strict": false,
      "contexts": ["verify (ubuntu-latest)", "verify (macos-latest)", "verify (windows-latest)", "e2e"]
    },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  ```

**Done when:**

- 13a. The workflow passes on a pull request from `chore/project-scaffold`, with all three `verify` jobs and the `e2e` job green.
- 13b. `gh api repos/tankafide/Plangineer/branches/main/protection` lists the four checks above as required.

### 14. Docs and rules

**Files:** `README.md`, `docs/engineering/stack-decisions.md`, `.agents/skills/tooling-and-infra/SKILL.md`, `.agents/skills/frontend-data/SKILL.md`, and their generated copies under `.claude/skills/`

- **`README.md`.** Says what Plangineer is in two sentences. It then gives setup as numbered commands:
  1. Node 24 and Docker Desktop.
  2. `pnpm install`.
  3. `pnpm setup:env`.
  4. `pnpm setup:github-app`.
  5. `pnpm dev`.
  6. `pnpm verify` and `pnpm test:e2e`.
- **`stack-decisions.md`.**
  - The Versions table gains pnpm 10.34.6.
  - The Commands table gains `pnpm setup:env`, `pnpm setup:github-app`, `pnpm db:up` and `pnpm db:migrate`.
  - The `pnpm verify` row lists the seven steps in order, including the skills mirror check.
  - The `pnpm dev` row says what it starts today: Postgres, migrations, API and web. MinIO, seed data and the fake agent join it with the features that need them.
  - A Conventions bullet says migrations come only from `drizzle-kit generate`.
- **`tooling-and-infra`.** Adds the `pre-push` verify and the two Claude Code hooks to its Hooks section, with their review rules. Replaces `onlyBuiltDependencies` with `allowBuilds` in its Workspace rules and review table.
- **`frontend-data`.** Renames `ResponseValidationLinkPlugin` to `ResponseValidationPlugin`, the export `@orpc/contract/plugins` actually has.
- Then run `pnpm skills:sync` and `pnpm skills:lint`.

**Done when:**

- 14a. Every command the README names exists in the root `package.json` and runs.
- 14b. `pnpm skills:check` and `pnpm skills:lint` pass after the skill edits.

## Decisions

Decisions D1 to D4 and D18 came from the engineer on Oct 7, 2026. The rest the planner made, and the engineer can overrule them.

- **D1. Node 24 through the official MSI.** Decided by the engineer. The agent installs it, and the engineer approves the download and the UAC prompt. A pnpm-managed Node was rejected, because hooks would still find Node 22 first on `PATH`.
- **D2. Foundation dependencies only.** Decided by the engineer.
  - Knip fails on any dependency that no code imports. So dnd-kit, CodeMirror, `diff`, `react-diff-view`, `eventsource-parser`, React Hook Form, Octokit, the AWS S3 SDK and `ws` arrive with the first MVP step that uses each one.
  - `env-paths` and `rehype-sanitize` follow the same rule.
- **D3. Better Auth and GitHub sign-in are in the scaffold.** Decided by the engineer.
  - The dev GitHub App comes from a local manifest-flow script (step 5), so the engineer's only GitHub action is one click.
  - The product's setup screen, which registers each deployment's app, is MVP work and separate from this dev script.
  - The app's webhook is inactive and subscribes to no events, because local dev has no public URL. The GitHub integration feature activates webhooks.
  - The permissions match `github-integration`, plus `emails: read` for sign-in per `auth-and-access`, so the app does not change when that feature lands.
- **D4. Branching.** Decided by the engineer. The project-skills work was committed, fast-forwarded into `main` and pushed as `df4e990`. This plan's branch, `chore/project-scaffold`, starts from that commit.
- **D5. Migrations come only from `drizzle-kit generate`.** `data-model-design` forbids `push`. That rule wins over the `push` advice in [tech stack](../engineering/tech-stack.md), and step 14 records it in the stack decisions.
- **D6. Same origin in development.** Vite proxies `/api` and `/rpc` to the API, so Better Auth's cookies and the GitHub callback all use `http://localhost:5173`, and no CORS is needed. Serving the built web app from the API in production is deployment work and left out.
- **D7. No seed data yet.** `persistence` seeds through repositories, and no feature repository exists yet. Dev sign-in uses real GitHub, so no user needs seeding. The first feature with data adds the seed module, and calls it from `pnpm dev` and `pnpm db:reset`.
- **D8. Node runs TypeScript directly.** Node 24 strips types, so the API and runner run `src/*.ts` with no `tsx` and no build. `tsconfig.base.json` allows only erasable syntax. Step 2's done-when line 2c proves this works before anything builds on it.
- **D9. pnpm 10.34.6, the newest pnpm 10, with `allowBuilds`.** pnpm 12.10.1 is the npm `latest`, but `tooling-and-infra` is written to pnpm 10. Moving to pnpm 12 is a separate change that updates that skill. pnpm 10.26.0 added `allowBuilds` and deprecated `onlyBuiltDependencies`, so the scaffold uses `allowBuilds`, and step 14 updates the skill to match.
- **D10. Turborepo runs `typecheck` and `dev` only.** The root-level tools (Oxfmt, Oxlint, dependency-cruiser, Knip, Vitest projects) already cover the whole workspace in one process. The per-package typecheck gains Turborepo's cache, and the `transit` task keeps that cache correct when an imported package changes. Nothing builds yet, so there is no `build` task.
- **D11. The `pg` driver.** `pg` gives a dedicated `Client` for the `LISTEN` connection that `api-server` requires later, and Drizzle's `node-postgres` driver uses it.
- **D12. No health endpoint.** Better Auth's `GET /api/auth/ok` tells Playwright that the API is up. Postgres readiness comes from the Compose healthcheck. An HTTP health route arrives with deployment work.
- **D13. `me.get` is the proving slice.** One authenticated procedure exercises contracts, the oRPC `authed` middleware, the API, the API client, TanStack Query and the web app. `packages/domain` is created by the first business decision. The runner is a `--version` stub until runner work starts.
- **D14. `.env` loading is explicit.** Apps load `../../.env` with Node's `--env-file`, and test setup uses `process.loadEnvFile`. Both fail loudly when the file is missing. CI copies `.env.example`, whose placeholders pass the schema and never reach GitHub, because every GitHub call in tests is intercepted.
- **D15. The Stop hook skips docs-only turns.** Running `pnpm verify` after a planning or docs turn costs time and proves nothing.
- **D16. `playwright-cli` installs globally.** No repository code imports it, so Knip would reject it as a dev dependency. Agents run it as a machine tool, like `claude`.
- **D17. The skills sync scripts stay in `scripts/`.** `runner-adapters` moves them into the runner's `skills sync` and `skills check` commands when those commands are built. The runner stub has neither command yet.
- **D18. Any GitHub user may sign in as `member` during the scaffold.** Decided by the engineer on Oct 7, 2026. `auth-and-access` requires the plan to decide who may sign in. Restricting sign-in, with a `databaseHooks.user.create.before` rule, is MVP auth work.
- **D19. Oxfmt formats code and config, not Markdown.** Docs and skills are written by hand to `writing-style`, and reformatting their tables would churn every file for no gain. Generated files are ignored too.
- **D20. dependency-cruiser parses with swc.** dependency-cruiser 18.5.0 parses TypeScript only through the compiler API of TypeScript below 7, and TypeScript 7.0.2 ships no compiler API. Its `swc` parser reads `.ts` and `.tsx` without one. Done-when 3c proves it. Knip cannot see that dependency-cruiser loads `@swc/core`, so `knip.json` ignores that one dependency.
- **Left out.**
  - The `INPUT_VALIDATION_FAILED` error mapping in the API. `me.get` takes no input, so the mapping arrives with the first procedure that does.
  - MinIO and the S3 SDK, until evidence storage. That plan rechecks which S3-compatible image to pin.
  - The fake agent and runner pairing, until runner work.
  - The committed OpenAPI file and its no-diff check, which no skill requires yet.
  - The server's production Docker image.
  - Codex hooks. The git hooks and CI already cover Codex.
  - Making the first user an admin, which is MVP auth work.
  - The second guardrail stage from [tech stack](../engineering/tech-stack.md).
- **Inputs.** Base commit `df4e990` on `main`. No exploration context files. Exploration was trivial, because the repository has no application code yet.

## Constraints

- **C1. Speed of `pnpm verify`.** With a warm Turborepo cache and Postgres running, `pnpm verify` finishes in under 60 seconds on the dev machine, so the Stop hook stays usable. The agent checks the time with `Measure-Command { pnpm verify }`.

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. Node 24.21.0 installed | | | | | ✓ | |
| 1b. Docker engine running | | | | | ✓ | |
| 1c. `playwright-cli` 0.1.22 installed | | | | | ✓ | |
| 2a. Frozen install succeeds | | | | | ✓ | |
| 2b. Typecheck passes and caches | | | | | ✓ | |
| 2c. Runner prints its version with no build | ✓ | | | | | |
| 2d. Runner usage on no argument | ✓ | | | | | |
| 3a. Verify runs seven steps in order | | | | | ✓ | |
| 3b. Each check fails on its violation | | | | | ✓ | |
| 3c. Layout violation shows the rule comment | | | | | ✓ | |
| 4a. `db:up` waits for a healthy Postgres | | | | | ✓ | |
| 4b. `db:up` reports Docker stopped | | | | | ✓ | |
| 4c. `setup:env` creates `.env` once | ✓ | | | | | |
| 4d. `setEnvValues` round-trips a PEM | ✓ | | | | | |
| 5a. Manifest fields | ✓ | | | | | |
| 5b. App created and credentials written | | | | | ✓ | |
| 5c. `checkCallback` rejects a wrong `state` | ✓ | | | | | |
| 6a. `MeGetOutput` validation and stripping | ✓ | | | | | |
| 7a. `parseEnv` success and error listing | ✓ | | | | | |
| 7b. `isLocalDatabaseUrl` | ✓ | | | | | |
| 7c. `db:reset` refuses a remote host | ✓ | | | | | |
| 8a. Better Auth user gets a uuidv7 id and default role | | ✓ | | | | |
| 8b. `me.get` unauthorized | | ✓ | | | | |
| 8c. `me.get` returns the user | | ✓ | | | | |
| 8d. `/api/auth/ok` returns 200 | | ✓ | | | | |
| 8e. Social sign-in returns the GitHub URL | | ✓ | | | | |
| 8f. RPC without the CSRF header rejected | | ✓ | | | | |
| 8g. API exits on a missing variable | | | | | ✓ | |
| 8h. `resetDatabase` recreates a cloned database with migrations | | ✓ | | | | |
| 8i. Parallel test databases are isolated and dropped | | ✓ | | | | |
| 8j. Oversized body gets 413 | | ✓ | | | | |
| 8k. Session cookie resolves through the app, none gives 401 | | ✓ | | | | |
| 8l. Client-sent role is ignored | | ✓ | | | | |
| 9a. `useMe` resolves the user | | | ✓ | | | |
| 9b. Bad response shape rejected | | | ✓ | | | |
| 9c. Retry policy | | | ✓ | | | |
| 10a. Sign-in button calls GitHub sign-in | | | ✓ | | | |
| 10g. Sign-in error alert | | | ✓ | | | |
| 10b. Account summary states | | | ✓ | | | |
| 10c. Retry recovers | | | ✓ | | | |
| 10f. Sign out clears the user and redirects | | | ✓ | | | |
| 10d. Web build succeeds | | | | | ✓ | |
| 10e. Layout and states at 1280 px and 375 px | | | | | ✓ | |
| 11a. `pnpm dev` serves the app | | | | | ✓ | |
| 11b. Sign-in journey on desktop and phone | | | | ✓ | | |
| 11c. Root `db:migrate` applies migrations | | | | | ✓ | |
| 11d. `test:e2e` refuses while `pnpm dev` runs | | | | | ✓ | |
| 12a. Hook decision functions | ✓ | | | | | |
| 12b. PostToolUse hook blocks a lint error | | | | | ✓ | |
| 12e. Hooks work from a subfolder | | | | | ✓ | |
| 12c. Stop hook blocks a failing test | | | | | ✓ | |
| 12d. Pre-push runs verify | | | | | ✓ | |
| 13a. CI green on three systems and e2e | | | | | ✓ | |
| 13b. `main` requires the four checks | | | | | ✓ | |
| 14a. README commands exist and run | | | | | ✓ | |
| 14b. Skills check and lint pass | | | | | ✓ | |
| C1. Verify under 60 seconds | | | | | ✓ | |

**What each layer covers.**

- **Unit tests** cover the pure script modules (`env-file`, `github-app-manifest`, `github-app-callback`, `claude-hooks`), the API's `parseEnv` and `isLocalDatabaseUrl`, the contract schemas and the runner CLI. The runner CLI runs through `node` with execa from a temp folder.
- **Integration tests** run in `apps/api` against real Postgres. Each file clones its own database from the run's template. They create users through Better Auth's adapter, and call the router and `app.request()`. No integration test calls GitHub, because Better Auth only builds the authorize URL.
- **API client tests** render `useMe` on jsdom with MSW handlers for `/rpc/me/get`, and are marked as component-layer tests. The web component tests use Testing Library on jsdom with MSW, a fresh `QueryClient` per test, and a mocked `authClient.signIn.social` network call through MSW.
- **The end-to-end journey** runs against a reset database and aborts the GitHub request.
- **Agent checks** cover machine state, command behavior, CI results and the screenshots.

## Verification

**Automated**

- `pnpm verify`
- `pnpm test:e2e`
- The CI workflow on a pull request from `chore/project-scaffold`

**Agent checks**

- Machine state: `node --version`, `docker info` and `playwright-cli --version` (1a to 1c).
- Commands: `pnpm install --frozen-lockfile` and `pnpm typecheck` twice (2a, 2b).
- Checks: one deliberate violation per check, each reverted after the run (3a to 3c).
- Reset: the real `pnpm db:reset` against the dev database, run once by hand (the test for 8h uses a clone).
- Postgres: `pnpm db:up` with Docker running and stopped (4a, 4b).
- GitHub App: `GET https://api.github.com/apps/<slug>` (5b).
- API: `pnpm --filter @plangineer/api start` with a variable removed from a copied `.env` (8g).
- Web: `vite build` (10d), and `playwright-cli` screenshots at 1280 px and 375 px (10e).
  - The agent opens the app with `playwright-cli open http://localhost:5173 --headed`, and the engineer signs in once in that window during the human check below. `playwright-cli` keeps its own in-memory profile, so a session from any other browser does not reach it.
  - Ready state: the signed-in home.
  - Failed state: `playwright-cli route` answers `**/rpc/me/get` with status 500, then the agent reloads.
  - Stale state: with the user on screen, the same route is added, then the agent triggers a refetch by refocusing the window.
  - The agent removes the route with `playwright-cli unroute` after each state.
- Dev stack: `pnpm dev` and the root `pnpm db:migrate` (11a, 11c).
- Hooks: the PostToolUse, Stop and pre-push behavior (12b to 12d).
- CI: results and branch protection (13a, 13b).
- E2E guard: `pnpm test:e2e` with `pnpm dev` running (11d).
- Hooks from a subfolder (12e).
- Docs: the README commands, and `pnpm skills:check` and `pnpm skills:lint` (14a, 14b).
- Speed: the timed verify run (C1).

**Human checks**

- **Engineer.** With `pnpm dev` running, in the `playwright-cli` window the agent opened at `http://localhost:5173`, click "Sign in with GitHub", authorize the dev app on GitHub, and confirm that the home page shows your GitHub name and email with the role `member`. Only the engineer can enter GitHub credentials.

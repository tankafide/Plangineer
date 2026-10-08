# Stack decisions

The decided stack, for agents working in this repo. The reasoning is in [tech-stack.md](tech-stack.md); read it only when a decision needs revisiting.

## Context

- Open source, self-hosted, one deployment per team. No tenancy and no organization model.
- The runner supports Claude Code first, then Codex. No Cursor.

## Versions

Pin these majors. Versions checked against npm on 6 October 2026.

| Area | Choice |
| --- | --- |
| Runtime | Node 24 everywhere (server and runner). pnpm 10.34.6 workspaces, Turborepo |
| Language | TypeScript 7, strictest tsconfig |
| Web | React 19, Vite 8, TanStack Router (not Start), TanStack Query, Tailwind v4, shadcn/ui on Base UI (never Radix) in the Nova style, Lucide icons, Geist and Geist Mono fonts, React Hook Form, dnd-kit, CodeMirror 6, `diff`, react-diff-view, `eventsource-parser` 4 |
| API | Hono 4, oRPC 1.x (not the 2.0 beta), Zod 4 |
| Database | Postgres 18, Drizzle ORM 0.45.x at 0.45.2 or later (earlier releases have CVE-2026-39356) and Drizzle Kit (not the v1 release candidate) |
| Auth | Better Auth 1.x with the Drizzle adapter and GitHub sign-in. No organization or SSO plugin |
| GitHub | One GitHub App per deployment, `octokit` 5 |
| Storage | Any S3-compatible store through the AWS S3 SDK; MinIO locally |
| Logging | pino |
| Lint and format | Oxlint with tsgolint (type-aware), Oxfmt. No ESLint or Prettier |
| YAML | `yaml` 2, for skill frontmatter in the API scan and the runner lint |
| Runner build | tsdown, which bundles `contracts` into the published `plangineer-runner` |
| Boundaries | dependency-cruiser, Knip |
| Tests | Vitest 5, Testing Library on jsdom for components, MSW, Playwright Test, `playwright-cli` for UI checks |
| Git hooks | lefthook |

## Package layout

| Path | Holds | May import |
| --- | --- | --- |
| `packages/contracts` | oRPC contract router and Zod schemas: API contracts, RunEvent, runner protocol | Zod, `@orpc/contract` |
| `packages/domain` | Pure logic: triage, staleness, amendment level, deviation matching | `contracts`, Zod |
| `packages/api-client` | Typed oRPC client and TanStack Query hooks | `contracts` |
| `apps/api` | Hono + oRPC control plane, Drizzle schema, run dispatch, webhooks | `contracts`, `domain` |
| `apps/web` | React SPA | `contracts`, `domain`, `api-client` |
| `apps/runner` | Local runner npm package and CLI adapters | `contracts`, `domain` |

Nothing imports from another `apps/*` package.

## Commands

| Command | Does |
| --- | --- |
| `pnpm setup:env` | Creates `.env` from `.env.example` with a fresh `BETTER_AUTH_SECRET` and placeholder GitHub App values |
| `pnpm setup:github-app` | Creates the dev GitHub App through GitHub's manifest flow, writes its credentials to `.env`, then opens its install page to pick repositories |
| `pnpm db:up` | Starts Postgres (Docker Compose) and waits for its healthcheck |
| `pnpm db:migrate` | Applies pending migrations to the dev database |
| `pnpm dev` | Starts Postgres, applies migrations, seeds, then runs the API and web. MinIO joins it with the feature that needs it. For runs without a model, start `pnpm runner:fake` beside it |
| `pnpm runner` | Runs the runner's CLI from the checkout: `pnpm runner login --server <url>`, then `pnpm runner start` |
| `pnpm runner:fake` | Starts the paired runner with the fake agent in place of `claude` |
| `pnpm runner:build` | Builds the runner's published CLI to `apps/runner/dist/cli.mjs` |
| `pnpm runner:publish` | Refuses a dirty working tree, builds, runs the runner's tests, then publishes `plangineer-runner` to npm. The engineer runs it |
| `pnpm db:reset` | Drops, migrates and seeds the dev database |
| `pnpm --filter @plangineer/api db:seed` | Seeds the dev database. Running it twice adds nothing |
| `pnpm skills:lint` | Runs the runner's `skills lint` on every skill, then this repository's routing, delegation and references checks |
| `pnpm verify` | Format check, skills mirror check, Oxlint, typecheck, dependency-cruiser, Knip, Vitest, in that order. Must pass before work is done |
| `pnpm test:e2e` | Playwright Test journeys against the local stack, on a database reset by `pnpm db:reset`. Must pass before work that adds or changes a journey is done |

## Conventions

- Run dispatch lives in the `runs` table (`FOR UPDATE SKIP LOCKED`, lease, heartbeat, cancel flag). No queue library.
- Realtime: SSE to browsers, tailing the append-only `run_events` table and resuming by event id. One outbound WebSocket per runner.
- Browsers read SSE with `fetch` and `eventsource-parser`, never `EventSource`, so the client controls headers, status codes and reconnects.
- Primary keys are `uuid` columns defaulted to Postgres 18's `uuidv7()`. Better Auth sets `advanced.database.generateId: "uuid"`, so its Drizzle adapter leaves ids to that default.
- Plan revisions are immutable rows with JSONB bodies.
- Migrations come only from `drizzle-kit generate` (`pnpm --filter @plangineer/api db:generate`). Never `drizzle-kit push` or Better Auth's `migrate`.
- Each app parses its environment with a Zod schema at startup and exits on any missing or invalid variable. Every variable is listed in `.env.example`.
- The API and runner log JSON with pino to stdout and `logs/<app>.log`.
- Hooks and repo scripts are Node scripts (`node scripts/<name>.mjs`), never bash or PowerShell. The skills commands are the one exception: the hook and the `skills:*` scripts run the runner's CLI through `node apps/runner/src/cli.ts`. No shell syntax in `package.json` scripts.
- Integration tests use real Postgres through template databases, never PGlite or mocks of the database.
- Tests never call a real model; runner tests use the fake agent and recorded JSONL fixtures.
- UI work is checked with screenshots at desktop and phone (375 px) widths before it is done.
- Claude Code runs as `claude -p --output-format stream-json`; Codex runs as `codex exec --json`. The runner never reads, stores or sends a vendor login.

## Cross-platform

Windows, macOS and Linux are equal targets. CI runs `pnpm verify` on all three.

- Paths through `node:path` and `fileURLToPath`; runner data under `env-paths`. No hard-coded separators, drive letters or `~`.
- LF everywhere, pinned by `.gitattributes` (`* text=auto eol=lf`). Parsers accept CRLF input.
- Kebab-case filenames; import paths match file case exactly.
- Spawn CLIs with execa, never `shell: true`.
- Stop a run by signalling its process group on macOS and Linux, and with `taskkill /T /F` on Windows.
- No symlinks. Copy files instead.

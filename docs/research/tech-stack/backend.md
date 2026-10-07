# Plangineer control-plane backend stack (state as of Oct 2026)

Method note: ~19 web searches/fetches. Many 2026 comparison posts are SEO aggregators (pkgpulse, automationatlas, supastarter); I treat them as weak evidence. Items marked "(no source)" in Inferences come from general engineering knowledge, not from a fetched page, and should be verified before commitment. Several fetched summaries contradict each other where noted.

Key architectural framing from mvp.md (read first): agent runs execute on runners (local runner on the engineer's machine over an outbound connection, or CI-job hosted runners), not inside the control plane. The control plane queues one job per run, receives streamed events, handles GitHub webhooks, and stores plans/revisions/threads/findings/runs in a DB plus evidence in object storage. This matters for the queue choice below: the control plane dispatches and tracks hours-long runs; it does not need to keep a process alive for them.

## Q1. Is a TypeScript monolith the best choice vs Go/Python/Rust?

### Takeaway
Yes: a single TypeScript (Node 24 LTS) monolith in a pnpm/turbo monorepo, sharing types with the web app, the local runner, and the agent-CLI adapters. The reference background-agent projects split languages (Open-Inspect: TS control plane + Python sandbox; Open SWE: Python backend + TS UI), which shows the cost of polyglot, not a requirement for it.

### Cited Findings
- Open-Inspect (MIT, ~3.3k stars, 1,770+ commits, active) uses a Next.js web client, a Cloudflare Workers + Durable Objects control plane (per-session SQLite, WebSocket hub, event streaming), and sandboxes on Modal/Daytona/Vercel Sandbox/E2B running Node 24, Python 3.12, Bun, git, GitHub CLI; agent runtimes are OpenCode or the Claude Agent SDK — [Open-Inspect repo](https://github.com/ColeMurray/background-agents)
- Open SWE (MIT) is built on Deep Agents and LangGraph, Python backend + TypeScript UI, per-thread persistent Linux sandboxes with LangSmith as default sandbox provider; README states "Correctness, stability, and compatibility are not guaranteed", breaking changes expected, external contributions not accepted (fork only) — [Open SWE repo](https://github.com/langchain-ai/open-swe)
- Open-Inspect's agent runtime options include the Claude Agent SDK, which is available in TypeScript — [Open-Inspect repo](https://github.com/ColeMurray/background-agents)
- Both reference projects are products tied to their own infrastructure choices (Cloudflare DOs, LangGraph/LangSmith); neither is a drop-in control plane for a Postgres-centric relational data model like Plangineer's ten record types. (From repo descriptions above.)

### Inferences
- The runner/adapter layer must parse Claude Code/Codex/Cursor CLI structured output (JSON streams) and the CLIs' own SDKs are TS/Python; one language across web, API, runner and adapters means event schemas are defined once (e.g. Zod) and reused everywhere. (no source for the sharing benefit; follows from the architecture in mvp.md)
- AI-agent friendliness: TypeScript has the largest training corpus among typed languages for web backends and gives compiler feedback loops (tsc, strict mode) that coding agents use well. Go is comparable for compile feedback but forces a second language for the web/mobile shared types; Rust adds slow compile cycles and little benefit for an I/O-bound CRUD+queue workload; Python lacks static guarantees at the same level and cannot share types with a React/React Native client. (no source)
- The workload is I/O-bound (webhooks, DB, event fan-out); CPU performance differences among Go/Rust/Node are irrelevant at prototype scale. (no source)
- Could use Go for the local runner (single static binary, easy install/self-update) - a real alternative - but MVP says the runner must stream events, run CLIs and self-update; shipping it as a Node SEA/Bun-compiled binary or npm package keeps one language. Flagged as the one place worth a later revisit.

### Gaps
- No benchmark found comparing agent code-generation quality across languages in 2026; I did not find a primary source on this, so the AI-friendliness argument is reasoning, not evidence.
- Did not verify Node 24 LTS status or TypeScript 6/7 (native compiler) release state from a primary source; Open-Inspect's sandbox using Node 24 is the only datapoint.

## Q2. Web framework and API style for a typed client shared by web and later mobile

### Takeaway
Hono (web framework, runs on Node) + oRPC (typed RPC with built-in OpenAPI 3.1) with Zod schemas shared via a `packages/contracts` workspace; SSE through Hono's streaming helpers (oRPC event iterators where convenient). Reject tRPC as primary because it emits no OpenAPI, which hurts a future native mobile app, runner/webhook consumers and non-TS tooling; reject GraphQL for added surface with no payoff.

### Cited Findings
- oRPC generates OpenAPI 3.1 natively and supports Zod/Valibot/ArkType via Standard Schema; tRPC cannot emit OpenAPI (plugin only); oRPC is the newer project with fewer examples — [PkgPulse comparison](https://www.pkgpulse.com/guides/orpc-vs-trpc-vs-hono-rpc-type-safe-apis-2026), [Supastarter comparison](https://supastarter.dev/blog/hono-vs-trpc-vs-orpc-api-comparison)
- tRPC v11 has ~35k GitHub stars, first-class TanStack Query v5 integration and subscriptions; best for TS-only full-stack apps — [PkgPulse comparison](https://www.pkgpulse.com/guides/orpc-vs-trpc-vs-hono-rpc-type-safe-apis-2026)
- Supastarter's verdict: tRPC for internal TS-only; oRPC when type-safe plus external consumers; Hono for standalone APIs. Supastarter itself supports Hono and oRPC — [Supastarter](https://supastarter.dev/blog/hono-vs-trpc-vs-orpc-api-comparison)
- oRPC v1 was announced Dec 2025 — [InfoQ](https://infoq.com/news/2025/12/orpc-v1-typesafe/), [oRPC v1 announcement](https://orpc.unnoq.com/blog/v1-announcement)
- Hono's `hc` typed client works across runtimes (Node, Workers, Vercel edge); Hono typing relies on validator middleware (Zod) — [PkgPulse](https://www.pkgpulse.com/guides/hono-rpc-vs-trpc-vs-ts-rest-type-safe-api-clients-2026), [Supastarter](https://supastarter.dev/blog/hono-vs-trpc-vs-orpc-api-comparison)
- Sources disagree on oRPC WebSocket support (PkgPulse: "Partial"); SSE/streaming was not covered by the fetched pages.

### Inferences
- Because Plangineer's clients are the first-party web app and a mobile app that "carries over" the UI, either tRPC or oRPC gives type safety; oRPC's OpenAPI output additionally lets a Swift/Kotlin app (if native is chosen, an open decision in mvp.md) generate clients, and lets coding agents and runners call the API via plain HTTP. (reasoning from findings)
- Fallback if oRPC maturity worries the team: Hono + `@hono/zod-openapi` (spec-first-by-code, REST) gives the same OpenAPI benefit with a much larger ecosystem, at the cost of a less ergonomic typed client. tRPC is acceptable if the mobile app is guaranteed React Native/Expo; the choice is reversible early because breaking changes are acceptable. (partly no source)
- Unverified: current oRPC version/commit activity in late 2026 and its React Query and SSE (`eventIterator`) behavior in practice; do a one-day spike before committing.
- Runner-to-control-plane protocol should be a separate, small, explicitly versioned-by-deploy WebSocket/HTTP schema (Zod) in the same contracts package.

### Gaps
- No primary-source 2026 data on oRPC adoption, release cadence, or known issues; sources are promotional aggregators.
- No evidence gathered on GraphQL; rejected from general reasoning only.

## Q3. Database, ORM, migrations, schema handling in prototype

### Takeaway
Postgres (single instance, JSONB for plan bodies and event payloads) with Drizzle ORM and drizzle-kit. Prototype loop: `drizzle-kit push` against dev and throwaway databases while the schema churns; switch to generated migrations (`generate` + `migrate`) from the first deploy that holds data you care about (likely before real team use in Phase 1 exit). Pin to the v1 release candidate line only if v1 is stable by project start; otherwise pin the last stable 0.x.

### Cited Findings
- Drizzle v1 is in release-candidate status (drizzle-orm 1.0.0-rc.x on the `@rc` tag, superseding `@beta`); new migration folder layout removes `journal.json` and groups SQL + snapshots per migration folder to cut Git conflicts; drizzle-kit moves from database snapshots to DDL snapshots and detects non-commutative migrations across branches; upgrade via `drizzle-kit up`; relational queries move to v2 via `defineRelations` — [Drizzle v1 upgrade docs](https://orm.drizzle.team/docs/upgrade-v1), [search summary](https://orm.drizzle.team/docs/latest-releases)
- Drizzle validator packages (zod etc.) were merged into the drizzle-orm repo — search summary of Drizzle docs, [latest releases](https://orm.drizzle.team/docs/latest-releases)
- Drizzle docs state migration engine test suite grew from ~600 to 9,000+ tests in 2025 (via third-party company-profile summary; low confidence) — [Drizzle company profile](https://kustiq.com/company/drizzle.team)
- Better Auth ships a Drizzle adapter and a generator for Drizzle schema — [Better Auth releases](https://newreleases.io/project/npm/better-auth/release/1.6.23)
- The fetched upgrade page does not itself compare push vs migrate.

### Inferences
- Drizzle's SQL-like, schema-as-TypeScript code is the format coding agents read and write reliably, and types flow directly into Zod via the built-in validator module, feeding the oRPC contracts. (partly no source)
- Alternatives: Prisma 7 (heavier, generated client; strong agent familiarity but separate schema language) and Kysely (query builder only, needs a separate migration tool) are credible; I did not verify Prisma 7 status. Rejected on balance for schema-in-TS single-source-of-truth and lighter runtime. (no source)
- Schema choice: store plan revisions as immutable rows with the plan body as JSONB (or per-section rows) and append-only `run_events` table partitioned later; findings as their own table because triage queries filter on their fields. Never edit revisions in place (mvp.md data model). (no source)
- "Push in prototype, migrate when data matters" is conventional guidance (no source); mitigate agent-written breaking changes by seed scripts so any DB can be recreated.

### Gaps
- Did not confirm whether Drizzle v1 reached stable by Oct 2026; the docs fetched still say RC. Check npm before project start.
- No 2026 head-to-head benchmark of Drizzle vs Prisma 7 vs Kysely found.

## Q4. Job queue / durable execution for long agent runs

### Takeaway
Start with pg-boss on the same Postgres, with the `runs` table as the source of truth (status, lease, heartbeat, cancel flag) and pg-boss only dispatching "claim a run" jobs and doing scheduled sweeps. Runners do the hours-long work, so the control plane needs leases, heartbeats, cancellation and per-repo/per-engineer concurrency, not step-level durable replay. Escalate to Trigger.dev (self-hosted or cloud, Apache 2.0) only if the control plane itself must execute long agent loops (e.g. hosted runners on its infrastructure). Reject Temporal and Hatchet for the prototype; Inngest's ~15-minute-ish serverless step ceiling and cloud-first model are a poor fit.

### Cited Findings
- pg-boss uses Postgres SKIP LOCKED; supports cron scheduling, priorities, dead-letter queues; pg-boss 12.18.2 was npm latest as of May 15, 2026; has a web dashboard, CLI and HTTP proxy — [pg-boss docs mirror](https://docsearch.algolia.com/mcp/docs/repo/timgit/pg-boss), [npm](https://npmjs.com/package/pg-boss)
- A comparison claims pg-boss lacks rate limiting, job flows, progress tracking and repeatable/cron jobs vs BullMQ — [PkgPulse](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026); contradicted by the pg-boss docs mirror above listing cron scheduling. Treat the PkgPulse feature table as unreliable.
- Trigger.dev v4: Apache 2.0, ~16.5k stars, tasks with no timeouts; checkpoint/suspend of containers during waits (not billed while paused), retries, queues/concurrency, wait tokens for human-in-the-loop, realtime streams (v4.5.14 added `from: "latest"`, cursor resumption); self-host via Docker/Kubernetes; self-host needs Postgres, Redis and S3-compatible storage; cloud free tier 50K runs/month — [Trigger.dev repo](https://github.com/triggerdotdev/trigger.dev), [v4.5.14 changelog](https://trigger.dev/changelog/v4-5-14), [PkgPulse](https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026) (that article dates from late 2024 and describes v3)
- Inngest: TS and Python SDKs, 50K step runs/month free, Hobby from $20/mo; one comparison claims ~15-minute durations due to serverless constraints and limited self-hosting — [Kestra roundup](https://kestra.io/resources/infrastructure/inngest-alternatives), [PkgPulse](https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026) (same dated article; not verified against Inngest docs)
- Temporal: seven-language SDKs, needs its own cluster plus worker fleet; one source estimates ~$200/mo Cloud at low volume or $2.5-4.5K/mo self-hosted — [automationatlas Inngest vs Temporal](https://automationatlas.io/guides/inngest-vs-temporal-2026-comparison/) (aggregator, low confidence on prices)
- Hatchet: DAG task graphs, priority scheduling, fine-grained concurrency, self-host via Helm/Docker Compose; described as 0.x pre-1.0 with the smallest community — [PkgPulse](https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026) (dated; verify current version)
- Open-Inspect avoids a job queue entirely: one Durable Object per session owns lifecycle and WebSocket streaming, and GitHub webhooks are deduplicated with KV keyed on `X-GitHub-Delivery` — [Open-Inspect docs](https://docsearch.algolia.com/mcp/docs/repo/colemurray/background-agents), [repo](https://github.com/ColeMurray/background-agents)

### Inferences
- mvp.md runner model (outbound connection, receives a job, streams events) implies pull/lease semantics: the runner claims a run, heartbeats, and the control plane marks it lost if heartbeats stop and re-queues or fails it. That is a small state machine in a Postgres table, which pg-boss (with `singletonKey`, expiry/retry, `cancel`) and plain SQL can implement; a workflow engine's replay model adds little for a process that runs in someone else's shell. (no source)
- Concurrency limits per engineer (shared subscription plan limits) and per repo are application rules; enforce them in the dispatcher query, not in the engine. (no source)
- Cancellation is cooperative: control plane sets `cancel_requested`, pushes a cancel frame to the runner, runner kills the CLI process tree. Any engine would still need that runner-side logic.
- Trigger.dev becomes attractive when the "hosted runner" is a Trigger.dev task that clones, launches the CLI and streams (it gives no-timeout containers, machine sizing, realtime streams). It would still be a dependency with Redis+Postgres to self-host; defer until Phase 2 "hosted runners" is actually built and CI jobs prove insufficient.
- Temporal is the most robust engine but is operationally heavy for a 1-2 person prototype team.

### Gaps
- Could not verify Inngest's current maximum run duration or whether it supports long-lived non-serverless workers in 2026 (sources are dated/aggregator).
- No primary-source confirmation of pg-boss cancel/expiry/heartbeat semantics for multi-hour jobs; verify from pg-boss docs (`expireInSeconds`, `heartbeatSeconds` in v12?).
- Did not find any independent postmortem of Temporal or Hatchet used for coding-agent orchestration.

## Q5. Real-time event delivery (clients and runners)

### Takeaway
Browser/mobile clients: SSE (one stream per feature/run, resumable with `Last-Event-ID` against a persisted event log). Runners: a single outbound authenticated WebSocket from the local runner (job dispatch down, events/heartbeats up), with an HTTPS POST batch fallback for CI-hosted runners. Fan-out between API instances through Postgres LISTEN/NOTIFY initially (single instance needs nothing).

### Cited Findings
- Open-Inspect's design: control plane is the WebSocket hub, with per-session event streaming to multiple client types (web, Slack, extension), and the sandbox connecting back over WebSocket — [Open-Inspect repo](https://github.com/ColeMurray/background-agents), [docs](https://docsearch.algolia.com/mcp/docs/repo/colemurray/background-agents)
- Trigger.dev realtime streams offer resumption cursors and latest-only subscription, an example of resumable stream semantics — [Trigger.dev v4.5.14 changelog](https://trigger.dev/changelog/v4-5-14)
- tRPC offers subscriptions; oRPC WebSocket support described as partial — [PkgPulse](https://www.pkgpulse.com/guides/orpc-vs-trpc-vs-hono-rpc-type-safe-apis-2026)

### Inferences
- Client side is one-directional (server to client), so SSE suffices and works through proxies, in browsers, and with mobile libraries; user actions use normal API calls. WebSocket stays only on the runner link where bidirectional dispatch/cancel is needed. (no source)
- Persist every event in a `run_events` table (sequence number per run) and treat SSE as a tail of that table; this gives replay, reconnect and the "run timeline" screen for free, and means the stream is not the source of truth.
- Durable Objects (Open-Inspect's route) are rejected: they would split data between DO SQLite and Postgres, contradicting the single relational store in mvp.md.

### Gaps
- No benchmark data on SSE vs WebSocket concurrency for Node in 2026; likely unnecessary at prototype scale.
- Did not verify behavior of Railway/Fly proxies with long-lived SSE (idle timeouts) from a primary source.

## Q6. Authentication and authorization

### Takeaway
Better Auth (self-hosted, TypeScript, Drizzle adapter, organization plugin, Expo package for mobile) for the prototype, keeping the user table in the same Postgres. Add WorkOS only when a customer demands SAML/SCIM; mvp.md lists "internal tool or product" as undecided, so keep auth behind a thin interface. Reject Clerk (per-org SSO fee, separate user store, vendor lock-in) for now.

### Cited Findings
- Better Auth 1.6.x releases in 2026 (1.6.23 latest 1.6.x seen; a 1.7.x line and a 1.8 beta docs site also exist); Drizzle adapter fixes shipped for D1/postgres-js; `@better-auth/expo` is a separate package — [newreleases 1.6.23](https://newreleases.io/project/npm/better-auth/release/1.6.23), [releases.sh](https://releases.sh/better-auth), [1.8 beta docs](https://better-auth.com/docs/beta/adapters/drizzle)
- Security caution: CVE-2026-53515: from 1.2.10 until 1.6.11, `@better-auth/sso` `POST /sso/register` let any organization member register an SSO provider without owner/admin role; fixed in 1.6.11 — [GitLab advisory](https://advisories.gitlab.com/npm/@better-auth/sso/CVE-2026-53515/), [SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-53515/)
- Official plugins cover 2FA, magic link, passkeys, organizations/teams, admin, API keys, OIDC provider, rate limiting; one source says enterprise SAML SSO is community-maintained — [Noqta](https://noqta.tn/en/blog/better-auth-typescript-authentication-library-2026) (the CVE shows an `@better-auth/sso` package exists, so that claim is partly outdated)
- WorkOS leads on SSO/SCIM/audit logs; Clerk on embedded UI/React DX. WorkOS charges ~$125/SAML connection/month; Clerk SSO ~$50/month per organization; AuthKit free to 1M MAU — [WorkOS vs Auth0 vs Clerk](https://guptadeepak.com/ciam-compass/guides/workos-vs-auth0-vs-clerk/), [WorkOS compare](https://workos.com/compare/clerk) (vendor-authored; pricing may be stale)

### Inferences
- Plangineer authorization is mostly row-level: user is member of org, org owns repos, features, plans; approvals require a different user than the author. Implement as explicit policy functions in the API layer plus Postgres foreign keys; no need for an external authz engine (OpenFGA/Cerbos) yet. (no source)
- Sign-in with GitHub (via Better Auth's GitHub social provider) identifies the engineer; repository access still goes through the GitHub App installation (see Q7). The runner pairing uses a device-code style flow producing a scoped runner token. (no source)
- Given the active CVE history in the SSO plugin, avoid the SSO plugin until needed and pin/upgrade promptly; auth libraries need dependabot-style watching.

### Gaps
- Did not verify Better Auth's version/stability as of Oct 2026 beyond release listings, nor its mobile (Expo) maturity.
- WorkOS and Clerk pricing from comparison pages that may be vendor-biased; verify directly if SSO becomes necessary.

## Q7. GitHub integration

### Takeaway
A single GitHub App (not an OAuth App): installation tokens (1 hour, minted by the control plane with the app private key) for webhooks, PR creation, checks and repo reads, and user-to-server tokens only if actions must be attributed to the engineer. Libraries: `octokit` (or `@octokit/app` + `@octokit/webhooks`) for JWT/installation auth, typed webhook handlers and REST; verify `X-Hub-Signature-256`, dedupe on `X-GitHub-Delivery`, respond 2xx fast and enqueue the work.

### Cited Findings
- GitHub's docs recommend GitHub Apps as the default for new integrations; installation tokens expire after 1 hour, OAuth tokens live until revoked; GitHub Apps have centralized webhooks across all accessible repos/orgs whereas OAuth apps need per-repo/org webhooks; app rate limits scale with repos/users — [GitHub docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [Nango](https://nango.dev/blog/github-app-vs-github-oauth)
- Apps use fine-grained, selectable permissions and keep working if a user leaves; OAuth tokens inherit broad user scope and need a user context — [Nango](https://nango.dev/blog/github-app-vs-github-oauth)
- Open-Inspect uses a GitHub App with selectable repository scope; sandbox git credentials are limited to the session's repositories; webhooks are deduplicated with KV on `X-GitHub-Delivery` — [Open-Inspect repo](https://github.com/ColeMurray/background-agents), [docs](https://docsearch.algolia.com/mcp/docs/repo/colemurray/background-agents)
- Open SWE uses a GitHub App with installation-wide default access, narrower scopes for some workflows — [Open SWE repo](https://github.com/langchain-ai/open-swe)

### Inferences
- mvp.md says runners need short-lived scoped credentials: mint installation tokens with `repositories` and `permissions` restricted per run (GitHub API supports this; no source fetched) and pass only that token to the runner. The local runner could instead use the engineer's own git credentials; make this a per-role setting.
- Needed permissions (no source, to verify): Contents rw, Pull requests rw, Checks/Statuses, Metadata r, Actions r (CI results and, for CI-based hosted runners, `workflow_dispatch` via Actions rw). Events: push, pull_request, pull_request_review, check_run/check_suite, workflow_run, deployment_status (deploy-triggered verification), installation.
- Use the GitHub-hosted pipeline's `deployment_status` events or a CI-posted webhook for the "deploy webhook" in Phase 3.
- Webhook handler idempotence table keyed by delivery id in Postgres replaces Open-Inspect's KV.
- Probot is a possible convenience but mostly wraps the same Octokit; not necessary.

### Gaps
- Did not fetch the specific current docs for fine-grained permissions list, `octokit` package structure, or recommended webhook best practices; recommendations above are from general knowledge.
- Not covered: GitHub Enterprise Server, GitLab (mvp.md assumes GitHub).

## Q8. Object storage and hosting for a prototype

### Takeaway
Hosting: Railway (or Fly.io) for one Node container + Postgres + the web app, to minimize ops; object storage: Cloudflare R2 (S3-compatible, no egress fees) accessed via the S3 SDK with presigned URLs, so it can be swapped for S3. Keep the app a single Docker image so moving later is trivial.

### Cited Findings
- 2026 comparison: Railway is fastest from `git push` to production with the best database UX (one-click Postgres, auto-injected connection strings), Pro plan $20/month needed for production features; Render has predictable pricing and managed Postgres; Fly.io gives Docker control and global regions but Fly Postgres is not fully managed — [PkgPulse hosting comparison](https://www.pkgpulse.com/guides/railway-vs-render-vs-fly-io-app-hosting-platforms-2026), [Techsy](https://techsy.io/en/blog/railway-vs-render-vs-fly-io)
- Render free web services spin down after 15 minutes idle with 30-60 s cold starts; Railway and Fly paid plans do not have cold starts — [PkgPulse hosting comparison](https://www.pkgpulse.com/guides/railway-vs-render-vs-fly-io-app-hosting-platforms-2026)
- Open-Inspect runs its control plane on Cloudflare Workers/Durable Objects and sandboxes on Modal etc.; mvp.md rejects dedicated sandbox infrastructure initially — [Open-Inspect repo](https://github.com/ColeMurray/background-agents)

### Inferences
- A long-lived Node process holding WebSockets (runner links) and SSE streams suits a container platform; serverless (Vercel functions) is a poor fit for these. Next/Vite web app can be a static or separate service. (no source)
- Postgres: Railway-managed or Neon; use point-in-time backups before real data. R2 vs S3: choose by existing cloud accounts; presigned PUT lets runners upload evidence directly, with the control plane storing only keys.
- For hosted runners in Phase 2, GitHub Actions jobs (per mvp.md) are triggered from the control plane via `workflow_dispatch` and call back to the API with a short-lived run token.

### Gaps
- No pricing verification, Railway/Fly SSE idle-timeout behavior, or R2 current pricing fetched. Hosting comparisons are aggregator content.

## Recommended stack summary and rejected alternatives

### Takeaway
Primary: TypeScript/Node 24 monorepo; Hono + oRPC (OpenAPI 3.1) + Zod contracts; Postgres + Drizzle (push in dev, migrations once data matters); pg-boss + `runs` table lease/heartbeat protocol; SSE to clients and outbound WebSocket from runners, backed by a persisted event table; Better Auth + GitHub App (Octokit); R2; Railway container + managed Postgres.

### Cited Findings
- (See per-question findings above for sources of each component's characteristics.)

### Inferences
- Rejected: Go/Rust/Python backend (breaks shared types and AI-agent training-data advantage for a React/TS frontend; I/O-bound workload gains nothing); tRPC as primary (no OpenAPI, TS-only clients); GraphQL (schema/resolver overhead, weak fit for event streams); Temporal (cluster ops cost for a process that runs elsewhere); Hatchet (0.x, small community per a dated source); Inngest (cloud-first, serverless duration limits per aggregator sources); Trigger.dev (good, but adds Redis+Postgres+S3 to self-host or a cloud dependency; revisit for hosted runners); BullMQ (adds Redis for no gain); Durable Objects/Cloudflare-only control plane (splits data store); Clerk (cost, lock-in); OAuth App for GitHub (user-scoped, per-repo webhooks).
- Revisit triggers: control plane must run agent loops itself -> Trigger.dev; multi-tenant enterprise customers -> WorkOS; mobile native non-TS -> generate clients from oRPC OpenAPI.

### Gaps
- Late-2026 versions to pin were not verified for Hono, oRPC, Node, TypeScript, Octokit; check npm at project start.

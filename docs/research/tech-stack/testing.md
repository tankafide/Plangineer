# Testing stack and strategy for Plangineer

Scope: a TypeScript monorepo (React web, API/control plane with Postgres and job queue, local runner spawning agent CLIs and git worktrees, shared packages), written and tested mostly by AI agents. Date of research: 2026-10-06. Findings below are only from sources fetched this session; recommendations are in Inferences and are my opinion. Items I did not research are listed under Gaps.

## 1. Test runner and monorepo layout (Vitest vs Jest vs node:test vs bun test)

### Takeaway
Vitest is the primary recommendation: Vitest 5.0 went stable on 2026-09-03 and 4.1 added an agent-oriented reporter, test tags, `aroundEach` hooks and Vite 8 support. Jest, node:test and bun test were not researched in depth, so their rejection rests on inference.

### Cited Findings
- Vitest 4.0 marked Browser Mode stable and added visual regression (`toMatchScreenshot`) and Playwright trace support; browser providers became separate packages (`@vitest/browser-playwright`, etc.) and `context` is imported from `vitest/browser` — [VoidZero: Announcing Vitest 4](https://voidzero.dev/posts/announcing-vitest-4); [InfoQ](https://www.infoq.com/news/2025/12/vitest-4-browser-mode)
- Vitest 4.1 (published 2026-05-01 per one aggregator search result): test tags with filter expressions like `frontend && !flaky`; experimental `viteModuleRunner: false` (native Node imports, faster startup); `aroundEach`/`aroundAll` hooks (suited to DB transactions and tracing spans); `--detect-async-leaks`; GitHub Actions job summaries with flaky-test permalinks; Vite 8 compatible — [Vitest 4.1 blog](https://vitest.dev/blog/vitest-4-1)
- Vitest 4.1 added an "agent" reporter that reduces output for AI coding environments by suppressing passed-test details — [Vitest 4.1 blog](https://vitest.dev/blog/vitest-4-1)
- Vitest 5.0 is stable, released 2026-09-03; requires Node 22.12.0+ and Vite 6.4.0+; 8-25% faster in most tested setups (up to 53% in some VM-pool setups); supports nested projects (useful for monorepos); Browser Mode gets an optional trace view; `vitest doctor` recommends faster config options — [OpenReplay: Vitest 5 changes](https://blog.openreplay.com/vitest-5-changes/) (search snippet also in [releases digest](https://releases.sh/collections/js-toolchain/digest/2026-08-31))
- Vitest 5 breaking changes: mocks cleared before each test by default (`clearMocks` true); unawaited async assertions now fail the test; `vi.mock()` must be file-level; reporter/blob/JUnit/HTML output defaults to `.vitest/`; `-t` separator changed from space to `>` — [OpenReplay](https://blog.openreplay.com/vitest-5-changes/)
- Vitest weekly downloads were reported growing from 7M to 17M — [VoidZero](https://voidzero.dev/posts/announcing-vitest-4)

### Inferences
- Pick Vitest 5.x with a root `projects` config (nested projects), one project per package/app: `node` environment for api/runner/shared, `browser` (Playwright provider) or jsdom/happy-dom for React components, a `db` project for Postgres-backed integration tests. Use tags (`slow`, `db`, `flaky-quarantine`) to select suites in CI.
- Wire the `agent` reporter (plus JSON/JUnit reporter to a file) as the default for agent invocations, so failures are low-token and machine-readable; keep the default reporter for humans.
- Vitest's unawaited-assertion failure and clearMocks default in v5 remove two classic agent-written false-pass patterns for free.
- Jest: rejected because ESM/TS/Vite-alignment friction and Vitest is the Vite-ecosystem default (not verified this session). node:test and bun test: rejected as primary because ecosystem for browser mode, projects, snapshot/mocking and Stryker integration is thinner (not verified). Keep node:test only as a possible choice for the tiny published runner binary if zero-dependency matters.

### Gaps
- No primary-source comparison of Jest 30/node:test/bun test performance or features in 2026 was fetched.
- Vitest 4.1 release date comes from an aggregator snippet, not the official post.
- Exact Vitest 5 `projects` config syntax and its interaction with sharding was not verified.

## 2. React component testing

### Takeaway
Use Vitest with Testing Library for most components, and Vitest Browser Mode (Playwright provider) for a smaller set of layout/phone-width/visual components. Browser Mode is stable since 4.0; I did not fetch Testing Library docs.

### Cited Findings
- Vitest Browser Mode runs component tests in a real browser rather than JSDOM/happy-dom, with the same Vitest API; supports screenshot comparison and Playwright trace files — [VoidZero](https://voidzero.dev/posts/announcing-vitest-4)
- Vitest 5 adds a Browser Mode trace view — [OpenReplay](https://blog.openreplay.com/vitest-5-changes/)
- Playwright 1.62 release notes list a "component testing redesign" (details not fetched) — [Playwright release notes](https://playwright.dev/docs/release-notes)
- Stryker's Vitest runner was reported as incompatible with Vitest Browser Mode by one practitioner, who used Claude Code to run mutations manually instead — [alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/) (single blog, treat with caution)

### Inferences
- Because every screen must work at phone width, real-layout checks (overflow, tap-target visibility, bottom sheet) belong in Browser Mode or Playwright with a mobile viewport, not jsdom, which has no layout engine.
- Query by role/accessible name only (Testing Library `getByRole`); this also aligns with Playwright's guidance and with ARIA snapshots.
- Do not put Browser Mode tests under Stryker; mutate only node-project logic (see section 7).

### Gaps
- Playwright 1.62 component-testing redesign details and whether it supersedes Vitest browser mode for React: not researched.
- Testing Library current version and docs: not fetched.

## 3. API/integration tests against real Postgres

### Takeaway
Recommend real Postgres via Testcontainers (one container per test run, migrate once into a template database, `CREATE DATABASE ... TEMPLATE` per worker or per file), with PGlite as an optional fast lane only for pure query/repository tests. PGlite is single-connection so it cannot faithfully test the job queue and concurrency.

### Cited Findings
- PGlite is a WASM Postgres, runs in-memory with zero Docker, reported to run tests in milliseconds with real SQL; cloning an instance gives near-instant database branching — [qaskills search summary](https://qaskills.sh/blog/testcontainers-postgres-per-test-database), [Makerkit](https://makerkit.dev/blog/tutorials/unit-testing-prisma-vitest) (search snippets)
- PGlite currently works through Postgres single-user mode (single connection); multi-connection support is the stated next big piece. Extensions include pgvector and community ones (pgcrypto, pgTAP, pg_uuidv7, PostGIS, Apache AGE) — [Electric: PGlite 10M weekly downloads, 2026-06-25](https://electric.ax/blog/2026/06/25/pglite-reaches-10-million-weekly-downloads.md)
- pg-mem is an interpretation of Postgres syntax, useful only for very basic tests (rejected) — [search summary of pg-testable/PGlite sources](https://github.com/andymitchell/pg-testable)
- Template database approach: run migrations once, close all connections, then `CREATE DATABASE new_name TEMPLATE prepared_name`; cheaper than server startup; templates built once can hide migration nondeterminism, so keep at least one CI job that migrates from empty; parallel workers risk connection exhaustion (e.g. 20 DBs x 10-connection pools = 200 sessions) — [qaskills: Testcontainers Postgres per-test database](https://qaskills.sh/blog/testcontainers-postgres-per-test-database)
- Once images are cached, Testcontainers is "really quite fast"; CI cold pulls were the slow part in one comparison (4m11s Actions job) — [HN thread summary](https://hn.nuxt.dev/item/44196945) (anecdotal)
- Vitest 4.1 `aroundEach` suits wrapping tests in DB transactions — [Vitest 4.1 blog](https://vitest.dev/blog/vitest-4-1)

### Inferences
- Primary: Vitest `globalSetup` starts one `postgres:<same major as prod>` Testcontainer (or uses `DATABASE_URL` from a CI service container, faster on GitHub Actions), runs migrations once into a template DB, and each Vitest worker creates its own DB from the template. Cap workers and pool size to avoid connection exhaustion.
- Inside a worker, use per-test transactions with rollback (via `aroundEach`) for ordinary repository/API tests; use per-file databases for tests that need commits, `LISTEN/NOTIFY`, advisory locks or the job queue (e.g. `FOR UPDATE SKIP LOCKED`) because the queue is multi-connection by nature.
- PGlite rejected as the main approach for Plangineer because the control plane's job queue and concurrency behaviours need real multi-connection Postgres, and fidelity drift between PGlite and production is a risk. Allowed as optional fast lane for pure SQL logic if it is ever too slow.
- pg-mem rejected (low fidelity). Shared dev database rejected (nondeterministic).
- One CI job should migrate from scratch (not template) and run migration up/down tests.

### Gaps
- No measured numbers for template-clone vs migrate-per-test on this stack.
- Which Postgres driver/ORM Plangineer will use was not specified, so adapter-specific advice (Drizzle, Prisma, Kysely) is untested.
- Job-queue library choice (pg-boss, Graphile Worker, BullMQ) is outside this brief; testing advice assumes a Postgres-backed queue.

## 4. Mocking agent CLIs and the GitHub API

### Takeaway
Use a fake CLI binary (a small Node script on PATH or a configured executable path) that replays recorded JSONL event streams, and MSW for GitHub HTTP. I found no source specifically about testing CLI-agent spawners; this part is mostly design reasoning.

### Cited Findings
- MSW intercepts at the network/fetch level in Node via `@mswjs/interceptors` and is described as the 2026 standard for isomorphic HTTP mocking; nock patches Node's http module and consumes interceptors by default, with scope assertions that all interactions occurred — [qaskills: MSW vs nock](https://qaskills.sh/blog/msw-vs-nock-for-node-api-tests), [PkgPulse](https://www.pkgpulse.com/guides/best-api-mocking-libraries-2026)
- Claude Code, Codex and Cursor each have non-interactive modes with structured output (from the product doc) — [mvp.md](C:\Users\shane\Documents\Apps\Plangineer\docs\product\mvp.md)

### Inferences
- Layered approach: (1) adapter unit tests parse recorded raw stdout lines from each real CLI (golden JSONL fixtures, one per CLI version) into Plangineer run events; (2) a `fake-agent` executable that takes a scenario file (emit these lines with these delays, exit code N, write these files into the worktree, hang, emit partial line, crash, ignore SIGTERM) used for runner integration tests spawning real processes and real git worktrees in a temp dir; (3) a small number of opt-in "live smoke" tests against the real CLIs, excluded from default CI and run nightly with a budget cap.
- Test streaming with fake timers only for backoff logic; prefer real process + short real delays or an event-driven scenario script, because stdout chunk boundaries (split lines, multi-byte splits, huge lines) are the real bug class. Add property-based tests (fast-check) on the line-framing/parser: any chunking of the same bytes yields the same events.
- Snapshot the normalized event stream (after stripping ids/timestamps/costs) with an inline or file snapshot, and review snapshot diffs as plan-level artifacts; protect snapshot files from agent edits (section 9).
- GitHub: MSW handlers backed by a typed fake (in-memory repo/PR state) rather than per-test ad hoc responses; assert request shape against Octokit/OpenAPI types. Webhooks: replay recorded payload fixtures with valid HMAC signatures.
- Record-and-replay fixtures need a refresh job (live recording script, run manually) and a date/version header so staleness is visible.

### Gaps
- No source on fake-CLI patterns, Codex/Cursor/Claude output schema stability, or recorded-fixture tooling (e.g. Polly.js, nock back); design is unvalidated by external sources.
- Whether Claude's `stream-json` event schema is versioned/stable was not researched.

## 5. Contract testing between API and clients

### Takeaway
In a TypeScript monorepo, a single shared schema package (Zod/OpenAPI-derived types) with runtime validation in tests beats Pact; Pact is for independently deployed consumers, which the later mobile app is not initially.

### Cited Findings
- Shared Zod schemas are a simpler alternative to Pact in monorepos; Pact automates drift detection but adds complexity and duplicate definitions; OpenAPI-first and Pact can be combined — [Speakeasy: Pact vs OpenAPI](https://www.speakeasy.com/blog/pact-vs-openapi), [PactFlow](https://pactflow.io/blog/contract-testing-using-json-schemas-and-open-api-part-3/) (via search summary; low-detail)
- The product requires the web app to use the same API a future mobile app will use — [mvp.md](C:\Users\shane\Documents\Apps\Plangineer\docs\product\mvp.md)

### Inferences
- Define request/response/event schemas once in `packages/contracts` (Zod), generate an OpenAPI document from them, commit it, and add a CI check that the generated file has no diff. Provider tests validate every response against the schema; consumer tests use MSW handlers generated from the same schemas, so a schema change breaks both sides.
- Run-event schemas (runner to control plane) deserve the same treatment, including a versioned envelope and a backward-compat test replaying old fixtures. Add an OpenAPI breaking-change diff (e.g. oasdiff) once the native mobile client exists.
- Pact rejected for now: overhead without independent deployments. Revisit when the mobile app ships on its own release cycle.

### Gaps
- Specific library comparison (ts-rest, oRPC, Hono RPC, tRPC) not researched; choice depends on API framework.

## 6. E2E with Playwright, agent-driven checks, traces, phone-width projects

### Takeaway
Use Playwright Test (1.63 is the latest per release notes) for Plangineer's own e2e, with desktop and phone-width projects, role-based locators, traces on failure and sharding; use `playwright-cli` for the product's agent-driven Verify stage. Treat Playwright test-agents (planner/generator/healer) as an authoring aid, not a CI component.

### Cited Findings
- Playwright release notes list 1.56 through 1.63: 1.56 Test Agents; 1.57 Speedboard and Chrome for Testing; 1.58 timeline in reports; 1.59 Screencast API, browser `bind()` (makes launched browsers available to playwright-cli and MCP), CLI debugger; 1.60 HAR recording on tracing; 1.61 WebAuthn passkeys; 1.62 component testing redesign, AbortSignal, WebP screenshots; 1.63 test locks, visible-only locators; Ubuntu 20.04 dropped, Node 16 dropped — [Playwright release notes](https://playwright.dev/docs/release-notes) (fetched summary; per-version dates not shown)
- Test Agents: `npx playwright init-agents --loop=claude` writes agent definitions (planner, generator, healer); a seed test sets up the environment; `specs/` holds Markdown plans, `tests/` the generated tests; role-based locators are recommended; the healer loops until tests pass or guardrails stop it and may skip tests it judges broken — [Playwright: Test agents](https://playwright.dev/docs/test-agents)
- Playwright CLI: `npm install -g @playwright/cli@latest`; `playwright-cli install --skills` installs agent skills; commands include `snapshot`, `screenshot`, `click`, `fill`, `goto`, named sessions (`-s=name`), `tracing-start/stop`, `recording-start/stop`, `console`, `show` dashboard — [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)
- One benchmark: about 27,000 tokens over CLI vs 114,000 over MCP for the same task; CLI writes snapshots/screenshots to disk; MCP suits long exploratory sessions or environments with only MCP — [Bug0](https://bug0.com/blog/playwright-cli-vs-playwright-mcp-ai-browser-testing-2026) (vendor blog, single benchmark)
- Default scaffold: retries 2 on CI, 0 local; trace `on-first-retry`; traces viewable from HTML report — [Playwright trace viewer intro](https://playwright.dev/docs/trace-viewer-intro)
- Sharding: `--shard=x/y`; with `fullyParallel: true` tests split per test else per file; blob reporter then `npx playwright merge-reports`; GitHub Actions matrix recipe provided — [Playwright sharding](https://playwright.dev/docs/test-sharding)
- Emulation: device registry sets user agent, viewport, touch; configurable per project or per test; colour-scheme, locale, timezone, offline emulation — [Playwright emulation](https://playwright.dev/docs/emulation)

### Inferences
- `playwright.config.ts` projects: `desktop-chromium` plus `phone` (a Pixel/iPhone device descriptor, 375-ish px width) running the same specs, and a `webkit-phone` project only for the critical flows. Every spec for a screen in the mvp.md phone table runs in both projects by default; a spec may opt out only with a tagged, reviewed reason. Add an automatic "no horizontal overflow" assertion helper in a shared fixture run after each phone test.
- Use role/label/test-id locators, `expect` web-first assertions, no `waitForTimeout` (enforce with lint), trace `retain-on-failure` locally and `on-first-retry` in CI, video off, `fullyParallel: true`, `retries: 1` in CI with a flake report (isolated retries in 1.63 help), and ARIA snapshots for structural assertions that are cheap for agents to read.
- Playwright e2e should run against the real API with real Postgres and the fake-agent binary, never real LLMs. Seed via API/DB fixtures, auth once via `storageState`.
- For the product's Verify stage (and for agents debugging UI work): `playwright-cli` with named sessions, evidence = screenshots + snapshots + trace zip saved to object storage. Prefer CLI over MCP per the mvp.md reasoning; keep MCP only where the agent host cannot shell out.
- Generated tests from the test-agents flow must be reviewed as code and must pass the anti-cheat gates (section 9) before landing; healer must not be allowed to edit assertions in CI-gating suites.
- Visual regression: use sparingly (a handful of phone-width screenshots of stable screens, same Docker image for baselines), because pixel diffs are flaky across OS and agents tend to blindly regenerate baselines. Prefer ARIA snapshots and geometry assertions.

### Gaps
- Per-version Playwright release dates and the exact 1.63 feature details were not retrieved; no confirmation of the CLI's current version number.
- No source on ARIA snapshot best practices or on visual regression flakiness data was fetched.
- Whether `playwright-cli` has stable machine-readable output and exit codes for the Verify stage was not verified.

## 7. LLM/agent-involving code: evals, replay, coverage and mutation, property tests

### Takeaway
Keep default CI fully deterministic (fake agent, replayed fixtures); put LLM-quality evals in a separate, non-blocking-or-budgeted suite. Use Stryker on pure-logic packages as a periodic/diff-scoped gate, and coverage as a floor not a target.

### Cited Findings
- Stryker's Vitest runner exists since StrykerJS 7.0, requires you to install your own vitest, configured via `testRunner: "vitest"` — [Stryker docs: Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
- StrykerJS 9.4.0 (2025-11-23) added Vitest 4 support — [qaskills search summary of release](https://qaskills.sh/blog/mutation-testing-stryker-guide-2026) (secondary source; Vitest 5 support not verified)
- Test Double's guidance: run format/lint/typecheck and tests after each agent change, add Stryker with an npm script scoped to modified files, instruct the agent to run it, watch for agents giving up before a full score; they reported scores like 94-96% in examples — [Test Double](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing)
- A practitioner using Vitest browser mode (Stryker incompatible) had Claude Code hand-apply mutations and found a 38% mutation score (5 of 13 killed) on a feature whose line coverage looked fine; recommended as a pre-merge tool, with Stryker preferred in pipelines — [alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)
- Tautest wraps StrykerJS for PR-scoped mutation on changed lines with surviving-mutant reports and AI-ready prompts — [search result summary](https://www.hunted.space/dashboard/tautest) (vendor/obscure source, unverified)

### Inferences
- Mutation testing is worth it here specifically because agents write the tests: it measures whether tests detect behavior changes, which line coverage cannot. Scope it: incremental Stryker on changed files in PRs for packages with pure logic (triage rules, plan staleness/overlap logic, amendment level computation, event parsing, deviation matching), with a threshold (e.g. break at 70-80%, high at 90%) and nightly full runs. Do not mutate React/Browser Mode tests or glue code.
- Coverage: collect with Vitest v8 provider; enforce a ratchet (no decrease) per package rather than a global target, and require coverage on changed lines in PRs. Coverage is a floor for "was executed", never evidence of quality.
- Property-based testing with fast-check (not researched this session) fits: plan-diff/amendment-level classification, staleness overlap, chunked-stream parsing, state-machine transitions (feature stage gates), idempotency of webhook handling. Use seeds recorded in failure output for deterministic replay.
- Agent-involving code: split into deterministic shell (prompts assembly, event parsing, state machine, triage rules) tested exhaustively, and the model-judgment parts (review quality, confirm step) tested through a small eval set (golden plans/diffs with known seeded defects, scored for recall/precision) run on demand and nightly with cost caps; store results as run records, not as gating unit tests. Deterministic replay = recorded event streams fed to the real adapter and downstream reducers, asserting final DB state and emitted notifications.

### Gaps
- fast-check, Promptfoo/Braintrust/Inspect-style eval frameworks, and snapshot-of-event-stream practice were not researched with sources; recommendations on them are my own reasoning.
- Stryker 9.x support for Vitest 5 and performance on a monorepo not verified.
- No independent data on how long full-mutation runs take at this scale.

## 8. Fast CI: sharding, caching, pyramid for a prototype

### Takeaway
Shard Playwright with the blob reporter; run Vitest per-project with caching and affected-only selection; keep the pyramid heavy at unit/integration and thin at e2e.

### Cited Findings
- Playwright sharding with blob reports and `merge-reports` as above — [Playwright sharding](https://playwright.dev/docs/test-sharding)
- Vitest 4.1 provides GitHub Actions job summaries and flaky-test permalinks automatically; Vitest 5 benchmarks 8-25% faster — [Vitest 4.1 blog](https://vitest.dev/blog/vitest-4-1), [OpenReplay](https://blog.openreplay.com/vitest-5-changes/)
- Vitest 5 changed default output locations to `.vitest/`, which CI artifact/cache paths must reflect — [OpenReplay](https://blog.openreplay.com/vitest-5-changes/)

### Inferences
- Prototype pyramid (by count, roughly): many unit tests of pure logic (fast, property tests included); a solid layer of integration tests (API + real Postgres, runner + fake-agent + real git worktrees, GitHub via MSW); a thin component layer (Testing Library for behavior, a few browser-mode phone-width tests); a very thin e2e layer (about 10-20 Playwright journeys: intake, plan edit, review/triage on phone, run timeline with fake agent, verification report). Evals and live-CLI smoke tests sit outside the blocking pipeline.
- CI shape: install with a lockfile and cached package-manager store; a task runner with remote/local caching (Turborepo or Nx, not researched) so unchanged packages skip; Vitest projects split into jobs (`unit`, `integration` with a Postgres service container, `component`); Playwright `--shard=n/4` against a prebuilt app image with browsers cached by Playwright version; Stryker diff-scoped in PRs; one from-empty migration job. Target: PR gate under about 10 minutes; fail fast on typecheck/lint first.
- Quarantine flaky tests with a Vitest tag and a ticket requirement rather than retries by default; track retry counts.

### Gaps
- No source consulted for Turborepo/Nx cache behavior, GitHub Actions runner sizing, or Postgres service-container startup times.
- Timing targets are my estimates, not measured.

## 9. Guardrails against vacuous or weakened tests by agents

### Takeaway
Separate the doer from the judge structurally: make gating tests unwritable to the implementing agent, check test diffs in CI outside the agent's reach, and use mutation testing plus holdout tests. Linters alone cannot detect dishonest-but-valid code.

### Cited Findings
- Documented agent behaviors: changing assertions to tautologies (`assert result == result`), wrapping tests in `if False`, injecting `sys.exit(0)` into the runner, hardcoding expected values, always-true verification functions; recommended guardrails: read-only tests via PreToolUse hooks or filesystem permissions, diff-guard in CI, a hidden holdout acceptance set — [DEV: agent will pass any test it's allowed to edit](https://dev.to/penloom_studio_829b7817d3/your-ai-agent-will-pass-any-test-its-allowed-to-edit-51fo) (blog; claims about vendor documentation not independently checked)
- Analysis of 327 agent-attributed PRs: six patterns (swallowed errors, relaxed assertions such as `.toEqual` to `.toBeTruthy`, assertion stripping, no-op fixes where only tests change, fake refactors, `@ts-ignore`/eslint-disable suppression); 8% flagged by maintainers, ~2% under stricter review; 7 of 27 flagged PRs merged anyway; heuristics produce advisory flags, and only runtime reproduction justifies blocking — [DEV: Kinnard's 327 PR analysis](https://dev.to/moonrunnerkc/ai-agents-cheat-on-pull-requests-i-mined-327-of-them-to-prove-it-43ij) (single-author analysis)
- Research on reward hacking: GPT-5 reported to exploit test cases 76% of the time on the one-off version of ImpossibleBench; 16 attack types across 13 benchmarks — [ImpossibleBench write-up](https://www.greaterwrong.com/posts/qJYMbrabcQqCZ7iqm/impossiblebench-measuring-reward-hacking-in-llm-coding-1), [Berkeley RDI](https://rdi.berkeley.edu/blog/trustworthy-benchmarks) (via search summary)
- Mutation testing surfaced weak agent-written tests that passed (boundary `>=` vs `>`) — [Test Double](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing), [alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)
- Playwright healer may skip tests rather than fix them and runs until guardrails stop it — [Playwright test agents](https://playwright.dev/docs/test-agents)
- Vitest 5 makes unawaited async assertions fail — [OpenReplay](https://blog.openreplay.com/vitest-5-changes/)

### Inferences
Recommended guardrail stack for Plangineer (it fits the product's own plan model, where each "done when" line maps to a test plan row):
1. Test-plan-first: tests for each acceptance criterion are specified in the approved plan; the implementation orchestrator writes them, but a separate test-review pass (different model) checks them against the criterion text before implementation counts as done.
2. Protected paths: a PreToolUse/hook-level and CI check that blocks edits to existing assertions, snapshots, `playwright.config`, `vitest.config`, coverage thresholds, Stryker config and CI workflows unless the run is explicitly tagged as an approved test change (e.g. CODEOWNERS plus required reviewer). New test files are allowed; modified/deleted existing tests are surfaced as a mandatory finding for human decision, mirroring the deviation/extra mechanism in mvp.md.
3. Diff-guard script in CI: flags removed `expect` calls, `.skip/.only/.todo/xit`, loosened matchers, added `@ts-ignore`/`eslint-disable`, lowered thresholds, snapshot updates; run by CI, not by the agent. Make `.only` a lint error and `forbidOnly` true in Playwright.
4. Lint rules for test quality (e.g. eslint-plugin-vitest: `expect-expect`, `no-focused-tests`, `no-disabled-tests`, `no-conditional-expect`, `valid-expect`); not verified in this research.
5. Mutation gate on changed pure-logic files (section 7) so tautological tests fail the build; coverage ratchet as a cheap backstop.
6. Holdout: the Verify stage already writes checks from the plan without seeing the implementation; treat it as the holdout acceptance layer, and keep its checks out of the implementing agent's workspace.
7. Failure output design: use the `agent` reporter plus a JSON report path, have error messages state expected vs actual and the criterion id (put the plan's acceptance criterion id in test titles, e.g. `AC-3: ...`) so agents fix code rather than the test; a CI check verifies every plan row has at least one test whose title references it.
8. Determinism rules: no real network, no real clock/random without injected seed, no sleeps, per-test isolated DB; run the suite twice (random order, `--sequence.shuffle`) in a nightly job to catch order dependence.

### Gaps
- The specific hook configuration syntax for Claude Code/Codex/Cursor protection was not fetched.
- The cheating-rate figures come from blogs and benchmark write-ups, not Plangineer-like workflows; they show the risk, not its frequency for this team.
- No evidence was found on how well diff-guard heuristics work in TypeScript repos beyond the single 327-PR analysis.

## Summary recommendation (for the report writer)

- Runner: Vitest 5.x with nested `projects`; agent reporter + JSON output. Rejected: Jest, node:test, bun test (see section 1, based on inference).
- DB: real Postgres (Testcontainers locally, CI service container) with migrate-once template DBs and per-worker databases; per-test transaction rollback via `aroundEach`; from-scratch migration job. PGlite only as optional fast lane; pg-mem rejected.
- Component: Testing Library for behavior; Vitest Browser Mode (Playwright provider) for a small set of phone-width layout tests.
- Mocks: fake agent CLI binary with scenario scripts + recorded JSONL fixtures; MSW (backed by a typed in-memory GitHub fake); nightly live smoke tests.
- Contracts: shared Zod schema package, generated and committed OpenAPI, provider response validation, schema-derived MSW handlers; Pact deferred.
- E2E: Playwright Test (1.63), desktop + phone projects, role locators, traces on failure, blob-report sharding; `playwright-cli` for agent Verify stage; test-agents only as authoring aid.
- Quality: Stryker on pure-logic packages (diff-scoped PRs, nightly full), coverage ratchet, fast-check for parsers/state machines, separate budgeted eval suite for LLM judgment.
- Anti-cheat: protected test paths via hooks and CODEOWNERS, CI diff-guard, lint rules, mutation gate, plan-row to test-title traceability, holdout Verify layer.

# Project skills plan

Oct 7, 2026

## Goal

Set up this repository's own skills, so Plangineer is built with the plan-driven workflow it will offer: four orchestrators that are invoked implicitly, and rule skills that only the orchestrators choose. This is development tooling for this repository, not a product deliverable. It follows the spirit of the Phase 0 loop in the [MVP](../product/mvp.md), plan, review, implement and review, but it does not have to match the product's workflow, and the product's repository setup is built separately. The rule skills are modelled on DeveloperNews and Searchafide, adapted to this project's [stack](../engineering/stack-decisions.md).

## Steps

Every skill lives at `.agents/skills/<name>/SKILL.md`. Every rule skill also has `.agents/skills/<name>/agents/openai.yaml`. `.claude/skills/` is a generated copy that step 1 creates, and nothing edits it by hand.

### 1. Skills mirror and its checks

**Files:** `package.json`, `.gitattributes`, `lefthook.yml`, `scripts/sync-skills.mjs`, `scripts/sync-skills.test.mjs`

- `scripts/sync-skills.mjs` mirrors `.agents/skills/` to `.claude/skills/`, one way. It copies every file, normalizes line endings to LF, deletes mirror files with no source, refuses symlinks and writes only files that changed.
- With `--check` it writes nothing. It exits non-zero on any missing, changed or stray mirror file, naming each one and the fix: edit the file under `.agents/skills/`, then run `pnpm skills:sync`. Differences only in line endings are not drift.
- The root `package.json` adds `pnpm skills:sync` and starts `pnpm verify`, which for now runs the check and the script's Vitest tests. Later tooling adds its own checks to `verify`.
- lefthook's pre-commit hook runs the check, not the sync. A sync there would silently overwrite an edit made to the mirror. With `--check --staged` the check reads both folders from the Git index, so it checks what is being committed and ignores unstaged edits.
- `.gitattributes` sets `* text=auto eol=lf` from the stack, and marks `.claude/skills/**` as `linguist-generated` so the mirror collapses in pull request diffs.
- The script is temporary. The runner's `skills sync` and `skills check` are the same feature, so when `apps/runner` lands, the root scripts call the runner's commands and `scripts/sync-skills.mjs` and its tests are deleted. There is never more than one implementation.

**Done when:**

- 1a. After any change under `.agents/skills/`, `pnpm skills:sync` leaves `.claude/skills/` an exact LF copy, with stray files removed.
- 1b. `pnpm verify` fails, naming the file and the fix, when a file under `.claude/skills/` is edited, added or missing.
- 1c. The pre-commit hook stops a commit that contains drift.

### 2. Move the context skills

**Files:** `.agents/skills/mvp-doc/`, `.agents/skills/tech-stack/`, and the generated `.claude/skills/` copies

Both skills move to the canonical folder and take the rule-skill tier settings. Neither is ever chosen by the model on its own, and both are loaded only by the user. Orchestrators read `docs/engineering/stack-decisions.md` directly, which saves a file read on every run.

| Skill | What it holds |
| --- | --- |
| `mvp-doc` | Loads `docs/product/mvp.md`: product behavior, workflow stages, data model and screens. Invoked only by the user. No orchestrator or rule skill loads it. |
| `tech-stack` | Loads `docs/engineering/stack-decisions.md`: pinned versions, package layout, commands and conventions. Invoked only by the user. |

**Done when:**

- 2a. Both skills live under `.agents/skills/` with both tier settings, and load with `/mvp-doc` and `/tech-stack` in Claude Code and with `$mvp-doc` and `$tech-stack` in Codex.
- 2b. Orchestrators read `docs/engineering/stack-decisions.md` directly, and none loads `tech-stack`. Planning and plan review always read it; implementation and implementation review read it only without a plan.

### 3. Shared references

**Files:** `.agents/skills/orchestrator-references/execution.md`, `finding-format.md`, `review-loop.md`, `git-workflow.md`, and `.gitignore`, which also ignores the `docs/plans/context/` files that `codebase-exploration` writes

One folder holds the rules the orchestrators share. It has no `SKILL.md`, so neither CLI lists it as a skill. Each orchestrator links the files it needs by relative path.

| Reference | Used by | Holds |
| --- | --- | --- |
| `execution.md` | All four orchestrators | The detail behind the delegation rule: what each handoff must include, disjoint file ownership for parallel writers, what a subagent returns, and reporting which skills were used. Adapted from DeveloperNews |
| `finding-format.md` | Both review orchestrators | The reviewer's finding fields: location, claim, kind, severity, suggested change and source skill. Findings stay in the conversation, and the fix commit records each one's outcome |
| `review-loop.md` | All four orchestrators | The review loop and who runs each step in this repository. See below |
| `git-workflow.md` | Planning (branch creation) and implementation | How work finishes. See below |

**The review loop.** `review-loop.md` holds one loop for both reviews, run at the manual level. Every review runs in a fresh session, ideally on the other CLI from the author, so Codex reviews what Claude Code wrote. The review orchestrator runs every step, and no findings file is written.

1. **Review.** The review orchestrator collects candidate findings in the shared format.
2. **Verify.** One subagent running `finding-verification` checks every candidate in a clean context, keeps only true findings a senior engineer would act on, and recommends what to do with each: address or skip for a defect, keep or revert for a deviation or extra.
3. **Select.** The engineer picks the defects to fix from a multi-select list, and keeps or reverts each deviation and extra, with the recommended choices marked and the dropped findings listed with their reasons.
4. **Fix.** The review orchestrator fixes what was picked and commits the round together. Plan review edits the plan with `plan-format` and `writing-style`. Implementation review fixes each defect under its area's rule skills with a test, keeps or reverts each deviation as chosen, and runs the checks. The commit body records every finding's outcome.
5. **Next.** It recommends whether to review again, and always recommends another round when it fixed three or more findings or the fixes changed a lot. The engineer decides. Another round always starts in a new fresh session, never in the one that fixed the last round. Rounds have no fixed limit.

Nothing is written to `.reviews/`. The fix commits keep the review history, and the pull request description is built from them.

**How work finishes.** `git-workflow.md` holds:

- **Branches.** Work starts on a branch named `<type>/<short-slug>`, with type one of `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. The branch is created when planning starts, or when implementation starts if there is no plan. Nothing is committed to `main` directly.
- **Commits.** One commit per pass: the plan when it is saved, an implementation pass once its checks have run, and each review round's fixes, so a round can be reverted alone. No commit waits to be asked for. The summary line is imperative and under 72 characters, and the body says why.
- **Pull request description.** Written to `writing-style`, it holds the plan summary with a link to the plan, the findings history for each review round with its outcomes, every departure from the plan with its reason and any keep or revert decision, and which checks ran and which did not.
- **Permission.** Committing needs no permission. The orchestrator pushes or opens the pull request only when the engineer asks.

**Done when:**

- 3a. The four files exist with the content in their rows and in the sections above.
- 3b. Neither Claude Code nor Codex lists `orchestrator-references` as a skill.
- 3c. `.reviews/` is ignored by Git.

### 4. Orchestrators, rule-skill stubs and the skills lint

**Files:** `.agents/skills/plan-orchestrator/SKILL.md`, `plan-review-orchestrator/SKILL.md`, `implementation-orchestrator/SKILL.md`, `implementation-review-orchestrator/SKILL.md`, a stub `SKILL.md` and `agents/openai.yaml` for every rule skill in steps 6 to 8, `scripts/lint-skills.mjs`, `scripts/lint-skills.test.mjs`, `package.json`, `lefthook.yml`

Each orchestrator states the delegation rule word for word under a `## Delegation rule` heading, holds its column of the routing table below under a `## Routing` heading, and has a description written to the trigger rules under Decisions. A rule skill that is not written yet is a stub: frontmatter, both tier settings and one line on what it will hold.

| Skill | What it holds |
| --- | --- |
| `plan-orchestrator` | The guided planning workflow. It reads the stack decisions, then uses the exploration context files if they were provided, or runs `codebase-exploration` if they were not, in a subagent unless the exploration is trivial. From the request and the findings it bounds the behavior and writes plain "done when" lines, using the scope the request gives. It chooses the design skills, decides what a senior engineer would decide alone, and asks the engineer only for business or use-case context or a choice between real trade-offs, as choices with a recommended option. It drafts with `plan-format` and `writing-style`, checks for blockers and repeats. The finished plan is saved and committed in `docs/plans/`. Plan review then updates the plan itself. |
| `plan-review-orchestrator` | What to check a plan for: anything undecided, vague steps, missing "done when" lines, coverage gaps, and design choices that break the stack or architecture. It runs `codebase-exploration` in verify mode, in a subagent unless the check is trivial, so the plan's claims are checked against the code and missed areas are found. It selects design and review skills for the areas the plan touches, has every candidate finding verified by `finding-verification` in a subagent, lets the engineer pick which to fix, then updates and commits the plan, as `review-loop.md` describes. |
| `implementation-orchestrator` | How to build, in two modes. **With a plan:** build nothing while any prerequisite is not marked resolved, work in phase order, settle contracts before parallel work, test each "done when" line, when the work shows the plan needs to change, make the change a senior engineer would make without widening the scope too much and give the reason in the final report, settle an open point when a senior engineer would see one clear right choice, and stop and ask when the choice needs the engineer's context or is a real trade-off. The design skills are consulted as rules when a step touches their area. **Without a detailed plan:** run `codebase-exploration` in a subagent when the area is unfamiliar or large, then load the design skills the change involves (`architecture-design`, `api-contract-design`, `data-model-design`, `testing`) and settle those decisions the way a senior engineer would before writing code, recording each one in the final report. A bug fix loads `debugging`. If the change needs a decision only the engineer can make, it stops and asks. Both modes run `pnpm verify` before finishing, and a change under `.agents/skills/` also runs `pnpm skills:sync` and `pnpm skills:lint`. `verify` grows as tooling lands, so the final report lists any check the stack names that `verify` does not run yet, such as a typecheck before TypeScript is set up, as not run. A check that did not run is never reported as passed. Implementation review then fixes the findings the engineer picks, and this orchestrator finishes the branch as `git-workflow.md` describes. |
| `implementation-review-orchestrator` | How to review a diff against the plan and the rule skills. With a plan, it always runs `plan-conformance`. Without one, it checks the diff against the request and the decisions the implementer recorded, and runs the design skills in review mode for any area those decisions cover. Either way it runs the implementation skills and concern reviews the diff touches in review mode, has every candidate finding verified by `finding-verification` in a subagent, lets the engineer pick defects and keep or revert each deviation and extra, then fixes, checks and commits, as `review-loop.md` describes. Fixes use `debugging` for bugs. |

**Routing table.** P is planning, PR plan review, I implementation, IR implementation review. Each orchestrator picks from its own column and never loads all of it. The table covers orchestrator use only: `codebase-exploration` also runs on its own in the Prepare stage. In the I column, `codebase-exploration` and the design skills matter most when there is no detailed plan.

| Skill | P | PR | I | IR |
| --- | :-: | :-: | :-: | :-: |
| `docs/engineering/stack-decisions.md`, read directly. Implementation and implementation review read it only without a plan, since an approved plan already carries the decisions | ✓ | ✓ | ✓ | ✓ |
| `codebase-exploration` | ✓ | ✓ | ✓ | |
| `plan-format` | ✓ | ✓ | | |
| `writing-style` | ✓ | ✓ | ✓ | |
| `architecture-design`, `api-contract-design`, `data-model-design` | ✓ | ✓ | ✓ | ✓ |
| `testing` | ✓ | ✓ | ✓ | ✓ |
| `ui-design-system`, `visual-style` | ✓ | ✓ | ✓ | ✓ |
| `agent-instructions` | ✓ | ✓ | ✓ | ✓ |
| `debugging` | | | ✓ | ✓ |
| `api-server`, `persistence`, `frontend-react`, `frontend-data` | | | ✓ | ✓ |
| `auth-and-access`, `run-orchestration`, `runner-adapters`, `github-integration` | | | ✓ | ✓ |
| `cross-platform`, `tooling-and-infra` | | | ✓ | ✓ |
| `plan-conformance`, `code-quality` | | | | ✓ |
| `security`, `performance` | | ✓ | | ✓ |
| `finding-verification` | | ✓ | | ✓ |

In the I column, `writing-style` is for pull request descriptions. In the IR column, `debugging` is for fixing a selected bug.

**The skills lint.** `scripts/lint-skills.mjs` checks the skills folder and exits non-zero on any problem, naming the skill and what is wrong:

- Every skill other than the four orchestrators has `disable-model-invocation: true` in its frontmatter, and an `agents/openai.yaml` that sets `policy.allow_implicit_invocation: false`.
- Every relative link in an orchestrator resolves to a file.
- The `## Delegation rule` sections of the four orchestrators are identical.
- Every skill named in an orchestrator's `## Routing` section has a `SKILL.md`.
- `orchestrator-references` has no `SKILL.md`.

It runs as `pnpm skills:lint`. lefthook runs it at pre-commit only when the commit touches `.agents/skills/`, and `implementation-orchestrator` runs it after any skill edit. Its own Vitest tests run in `verify` with the rest, and they include a run against the real folder, so `verify` also fails on a lint problem.

**Done when:**

- 4a. Each orchestrator states the delegation rule word for word, holds its column of the routing table, and links the shared references it uses.
- 4b. Each orchestrator's description states what it covers and what it does not, as in the trigger rules.
- 4c. Every rule skill exists at least as a stub with both tier settings, and only the four orchestrators can be chosen by the model in either CLI.
- 4d. `implementation-orchestrator` reports every check `pnpm verify` did not run.
- 4e. `pnpm skills:lint` passes on the finished folder, and fails, naming the skill and the problem, for each case in its list.
- 4f. The pre-commit hook runs `pnpm skills:lint` when a commit touches `.agents/skills/`, and not otherwise.

### 5. AGENTS.md routing

**Files:** `AGENTS.md`

A short section lists the four orchestrators with one line each on when to use them, and the tasks that need none: answering questions, reading docs, and editing docs that are not feature plans. It says that every other skill is a rule skill that orchestrators load by path. It also says that skills are edited only under `.agents/skills/`, followed by `pnpm skills:sync` and `pnpm skills:lint`, and that `.claude/skills/` is never edited. It lists no rule skills and repeats no orchestrator content.

**Done when:**

- 5a. Sample requests route as the trigger rules say, in both CLIs.

### 6. Planning and design skills

**Files:** `.agents/skills/<name>/SKILL.md` for each skill below

Written in this order: `codebase-exploration`, `plan-format`, `writing-style`, `architecture-design` and `testing` first, so planning works, then `api-contract-design` and `data-model-design`.

| Skill | Modes | What it holds |
| --- | --- | --- |
| `codebase-exploration` | Explore, verify | **Explore** starts from the feature brief and maps the code a feature touches in the format of the MVP's Prepare stage: the files and functions involved, existing code the change can reuse, how the area works today, open questions, risk flags and the base commit. **Verify** starts from a plan and its context files. It checks each named file, function and claim against the code at the base commit, then looks one step outward for callers, importers and tests the plan does not mention, and returns mismatches and missed areas as findings. When a plan names no existing code, verify only checks that the paths it creates or edits are where the plan says, and skips the outward look. Explore returns its result in the reply and writes a context file only when the caller asks for one. The product invokes explore directly, asking for a context file, as the pre-planning exploration task when a feature is submitted and on just the overlapping files when a staleness warning leads to Replan. `plan-orchestrator` and `implementation-orchestrator` invoke explore when no exploration was provided. `plan-review-orchestrator` invokes verify, so the reviewer checks the code itself instead of inheriting the planner's blind spots. It stands on its own and assumes no orchestrator, feature brief or other skill is loaded. |
| `plan-format` | Plan, plan review | The plan template the product itself uses: goal, prerequisites for setup outside the code, each marked open or resolved, steps with files and "done when" lines, decisions, constraints when flagged, the test plan coverage grid and verification. Also holds the blocker checklist a plan must pass before it is marked ready. |
| `writing-style` | Plan, plan review, implement | How plans, pull request descriptions and docs read, taken from the existing docs in `docs/`: lead with the point, one idea per sentence, plain words over jargon, tables for anything compared across rows, specific numbers and absolute dates, sources linked inline, and no filler or hedging. `plan-format` fixes a plan's structure and this fixes its prose, so every plan reads the same way. In plan review it flags prose that breaks the style as nits. |
| `architecture-design` | Plan, implement, both reviews | Where code belongs among `contracts`, `domain`, `api-client` and the three apps, and the import rules dependency-cruiser enforces. Covers dependency direction and never importing across apps, reuse before writing new code, a placement ladder for shared code (beside its caller, then the package's `src/lib/`, then a package), folders by feature rather than kind, no grab-bag files, fixing behavior where it is defined, and patterns built for known upcoming cases rather than imagined ones. Holds the rules for `packages/domain`: pure functions for triage, staleness, amendment levels and deviation matching, with no I/O, inputs and outputs typed from `contracts`, and exhaustive unit tests. |
| `testing` | Plan, implement, both reviews | **Plan:** maps each "done when" line to the smallest useful test layers: Vitest unit, integration against real Postgres, MSW, Playwright and agent checks. Fills the test plan grid and flags rows nothing covers. **Implement:** writing tests across the repo. Vitest for `domain`, `api` and `runner`, with template databases, MSW for GitHub and other HTTP, the fake agent and no real model calls. Vitest component tests in `web` with accessible queries, Playwright Test journeys against seeded data, and `playwright-cli` screenshot checks. Covers test naming, fixtures, keeping tests fast, and separating mocked-network tests from real-API integration. **Review:** whether tests prove each "done when" line in the test plan, use real Postgres where the plan says integration, and assert observable behavior. Flags weak assertions, skipped checks and coverage claimed but not run. |
| `api-contract-design` | Plan, implement, both reviews | Designing oRPC procedures and Zod 4 schemas in `packages/contracts`, including error shapes, pagination and the runner protocol and RunEvent schemas. Checks that a contract change is reflected in both the server and the client. |
| `data-model-design` | Plan, implement, both reviews | Designing Postgres tables with Drizzle: immutable plan revisions with JSONB bodies, the append-only `run_events` table, identities, constraints, indexes and what each record in the MVP data model owns. Owns migrations: writing them with Drizzle Kit and keeping them safe to run. |

**Done when:**

- 6a. Each skill holds the content in its row and states what it does in each mode it lists.
- 6b. `codebase-exploration` runs on its own, with no orchestrator or other skill loaded, and returns the context in explore mode, writing a context file only when asked, and findings in verify mode.

### 7. Implementation skills

**Files:** `.agents/skills/<name>/SKILL.md` for each skill below

Written in the order Phase 1 needs them: `tooling-and-infra`, `cross-platform`, `debugging`, `persistence`, `api-server`, `auth-and-access`, `frontend-react`, `frontend-data`, `ui-design-system`, `visual-style`, `runner-adapters`, `run-orchestration`, `github-integration`, `agent-instructions`.

Each skill with a review mode states the rules a reviewer checks a diff against in its area.

| Skill | Modes | What it holds |
| --- | --- | --- |
| `tooling-and-infra` | Implement, review | The pnpm workspace and Turborepo, `pnpm dev` with Docker Compose for Postgres and MinIO, `.env.example`, Node scripts under `scripts/` including the skills mirror and lint, lefthook, and the CI matrix across three systems. Covers Oxlint, Oxfmt, Knip and dependency-cruiser configuration, and adding each new check to `pnpm verify`. |
| `cross-platform` | Implement, review | Windows, macOS and Linux as equal targets: `node:path`, `env-paths`, LF line endings, exact import casing, execa without a shell, process-group or `taskkill` stops, and no symlinks. Lists the Windows assumptions most likely to slip in. |
| `debugging` | Implement | Fixing a bug at its root cause. Reproduce it first with a failing test at the lowest layer that shows it, then find the cause, fix it, and keep the test as a regression test. Check whether the same cause breaks anything else. Never fix a symptom by catching an error, adding a fallback or special-casing the input. When a bug cannot be reproduced in a test, such as one that only appears on one platform, record the manual steps that reproduce it and why no test can. |
| `persistence` | Implement, review | Drizzle queries and transactions, seed data for `pnpm dev` and `pnpm db:reset`, and integration tests on template databases. Schema and migrations belong to `data-model-design`. |
| `api-server` | Implement, review | Hono and oRPC routers in `apps/api`: handlers, middleware, Zod environment parsing at startup, pino logging and S3 evidence storage. Errors fail loudly with typed oRPC errors. |
| `auth-and-access` | Implement, review | Better Auth with GitHub sign-in and the Drizzle adapter, admin and member roles, and runner pairing with hashed tokens. Holds the rule that the app never reads, stores or relays a vendor login. |
| `frontend-react` | Implement, review | React 19 components and TanStack Router routes in `apps/web`: React Hook Form, dnd-kit for card reordering, CodeMirror for editing, and diff views. Every loading, empty, failed and stale state is explicit. |
| `frontend-data` | Implement, review | The typed oRPC client and TanStack Query hooks in `packages/api-client`, cache keys and invalidation, and SSE subscriptions that resume by event id. Covers optimistic updates where a click must feel instant. |
| `ui-design-system` | Plan, implement, review | Layout and components: shadcn/ui on Base UI (never Radix), and the phone-first rules: one column first, one decision per card, every action a button, nothing on hover alone. Includes the screenshot check at desktop and 375 px. |
| `visual-style` | Plan, implement, review | The look and feel: dark-first, clean and quiet, shadcn's Nova style with Lucide icons and Geist fonts, colour by semantic role with a fixed status mapping, type, spacing, depth and motion rules, and themes swapped by tokens so users can pick palettes later. Holds a token seed whose text pairs pass WCAG AA in both modes. Research in [visual style research](../research/visual-style.md). |
| `runner-adapters` | Implement, review | The npm runner in `apps/runner`: pairing, worktrees per feature and repository, the job queue and concurrency limit, the `skills sync` and `skills check` commands, and one adapter per CLI that turns `claude -p --output-format stream-json` (later `codex exec --json`) into RunEvents. Covers the fake agent and recorded JSONL fixtures. |
| `run-orchestration` | Implement, review | Run dispatch in the `runs` table with `FOR UPDATE SKIP LOCKED`, leases, heartbeats and cancel flags, and realtime delivery: SSE to browsers tailing `run_events` with resume by event id, and one outbound WebSocket per runner. |
| `github-integration` | Implement, review | The GitHub App and Octokit: installation tokens, webhook signature checks, and handling pushes to main, build results and merges. Covers opening pull requests with the plan summary, findings history and deviation list. |
| `agent-instructions` | Plan, implement, review | Writing the prompts, orchestrator templates and skill files the product generates and sends to agents. Keeps instructions short, testable and the same for Claude Code and Codex. What setup generates, such as the orchestrator templates, the skill specification and the baseline catalog, is decided in the setup feature's plan, not here. |

**Done when:**

- 7a. Each skill holds the content in its row.

### 8. Review skills

**Files:** `.agents/skills/<name>/SKILL.md` for each skill below

Written with `plan-conformance` first.

| Skill | Used by | What it holds |
| --- | --- | --- |
| `plan-conformance` | Implementation review | Matches every plan step and decision to the diff, and every change in the diff back to a step. Judges each departure: sound when it serves the step's intent, does not widen the scope too much, breaks no decision or rule, and is a call a senior engineer would make. Raises only the unsound ones, and states the plan audit row for each step. |
| `code-quality` | Implementation review | Correctness, naming, small single-purpose units, strict types, no dead code or speculative abstraction, and matching the surrounding style. Holds the AGENTS.md standards as review checks. |
| `security` | Both reviews | Authentication and roles, runner pairing, webhook verification, agent output and repository content treated as untrusted input, command injection through spawned CLIs, and secrets in logs. Applies to plans that add new trust boundaries. |
| `finding-verification` | Both reviews | Checks every candidate finding in a clean subagent before the engineer sees it. Keeps only true findings a senior engineer would act on in scope, drops a deviation or extra that is in fact sound, corrects severities, merges duplicates, and recommends address or skip for a defect and keep or revert for a deviation or extra. Never edits and raises no new findings. |
| `performance` | Both reviews | Unbounded lists and queries, missing indexes, N+1 queries, SSE and dispatch load on Postgres, and frontend bundle and render cost. Checks constraints from the plan are met and measured. |

**Done when:**

- 8a. Each skill holds the content in its row.
- 8b. `plan-conformance` returns a plan audit row for every step: built as planned, deviated or not built.
- 8c. `finding-verification` returns keep or drop for every candidate finding, with a reason, and a recommendation for each one kept.

## Decisions

### How the skills fit together

- **Orchestrators are implicit.** They are the only skills the model invokes on its own, and each one matches one workflow stage.
- **Rule skills are explicit.** Each is hidden from implicit invocation in both CLIs, so it loads only when an orchestrator selects it, the user names it, or the product runs it directly as a task. Some skills have to work without an orchestrator around them: `codebase-exploration` runs on its own as the Prepare stage's exploration task when a feature is submitted, before any planning starts.
- **Orchestrators choose.** Each orchestrator has a routing table of when each rule skill applies. It loads only what the task needs, at the point it needs it, and may use a skill more than once, such as `testing` once per phase or `security` once per affected area.
- **Some rule skills have more than one mode.** A design skill such as `data-model-design` is used to decide during planning and to check during plan review and implementation review. The skill states what it does in each mode.
- **Subagents only when they pay off.** Every orchestrator follows the delegation rule below. Any exploration that is not trivial counts as case (a) and runs in a subagent. Trivial means a handful of files the orchestrator already knows it needs.
- **AGENTS.md routes to the orchestrators.** Choosing a skill from its description is unreliable on tasks that don't look like feature work, so AGENTS.md lists the four orchestrators with one line on when each applies, and names the tasks that need none. It lists no rule skills and repeats no orchestrator content.
- **Shared rules live in one references folder.** Execution rules, the finding format, the review loop and the Git workflow sit in `.agents/skills/orchestrator-references/`, beside the orchestrators that link them. One folder is easier to find than references scattered across orchestrators that all use them.

### How skills are invoked

There are two tiers, and each skill sets its tier for both CLIs.

| Tier | Claude Code | Codex | How it loads |
| --- | --- | --- | --- |
| Orchestrators | Model-invocable (default frontmatter) | Implicit invocation allowed (default) | The model picks it from its description, backed by the routing section in AGENTS.md |
| Rule skills | `disable-model-invocation: true` in the frontmatter | `policy.allow_implicit_invocation: false` in the skill's `agents/openai.yaml` ([Codex docs](https://learn.chatgpt.com/docs/build-skills)) | The orchestrator reads the skill's `SKILL.md` by path with its file-read tool, or the user invokes it by name (`/name` or `$name`) |

Hiding a skill from implicit invocation also stops the model loading it through the Skill tool, so orchestrators always read rule skills by path. This works the same in the orchestrator itself, in a subagent and in both CLIs.

### When each orchestrator runs

Each orchestrator's description says what it covers and what it does not, so a request that only looks like a stage does not start one.

| Orchestrator | Runs for | Does not run for |
| --- | --- | --- |
| `plan-orchestrator` | Planning a feature or change | Questions, explaining code, and writing or editing product docs, research or other documents |
| `plan-review-orchestrator` | Reviewing a plan in `docs/plans/` written in the plan format, and fixing the findings the engineer picks | Reviewing code, diffs or branches; reviewing product docs, research or other documents; answering a question about a plan without reviewing it |
| `implementation-orchestrator` | Writing or changing code, tests, config, scripts or skills, with or without a plan; fixing bugs; and finishing a branch with its commits and pull request | Edits only to docs; questions |
| `implementation-review-orchestrator` | Reviewing a diff, branch, commit or pull request, and fixing the findings the engineer picks | Reviewing plans or documents |

### Delegation rule

Each of the four orchestrators states this rule word for word in its own `SKILL.md`, not only through a linked reference, so it is in front of the agent every time an orchestrator loads:

> Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

Why it reads this way:

- Multi-agent runs use 3 to 10 times the tokens of one agent, and here those tokens come out of the engineer's own plan limits ([Anthropic](https://www.claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)).
- Work should be split by the context it needs, not by role or phase, and only where that context can be isolated ([Anthropic](https://www.claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)).
- Multi-agent setups work best when writes stay single-threaded and the extra agents contribute thinking and review ([Cognition](https://cognition.com/blog/multi-agents-working)).
- Subagents that get only a summary misread their task, so the handoff carries the skill paths and the decisions ([Cognition](https://cognition.ai/blog/dont-build-multi-agents)).
- Rule skills set `disable-model-invocation: true`, which stops Claude Code from preloading them into a subagent through the `skills` field ([Claude Code docs](https://code.claude.com/docs/en/skills)). Passing the paths for the subagent to read works in both Claude Code and Codex.

### Review loop

- **Review runs on the other CLI where possible.** The MVP recommends review by a different model, so in this repository Codex reviews what Claude Code wrote. When only one CLI is available, review still runs in a fresh session.
- **Findings are verified before anyone sees them.** Reviewers raise findings that are wrong or not worth the change. A subagent running `finding-verification` checks every candidate in a clean context first, so the engineer only chooses among findings that hold up. This replaces the author's confirm step and the triage rules.
- **The review fixes what the engineer picks.** Once findings are verified and picked, the fixes are already decided. Handing them back to the authoring orchestrator would need a second session and a findings file to carry them, and a separate editing subagent would need the context handed over again. The review orchestrator fixes inline under the same rules the author follows: `plan-format` and `writing-style` for a plan, and the area's rule skills, a test and the checks for code. When Codex reviews code Claude Code wrote, Codex writes the fixes, with the same skills.
- **Departures are judged, not logged.** Implementation can show that the plan needs to change, and that is expected. Review checks that each departure makes sense, does not widen the scope too much, and is a call a senior engineer would make, and raises only the ones that fail. A raised one is kept as built or reverted, never replanned, and the plan is not rewritten to match.
- **History lives in Git.** Each round's fix commit records every finding's outcome and, for implementation review, the plan audit. No findings file or deviation log is kept.
- **The engineer decides every re-review.** This repository runs at the MVP's manual level with the Ask setting: there is no auto-loop and no fixed number of rounds.

### Skills mirror

- **Canonical folder.** Skills are written in `.agents/skills/` and copied to `.claude/skills/`. This change also records the decision in the MVP, with the runner's `skills sync` and `skills check` as the product's version of the mirror. Codex reads only `.agents/skills/`, and Claude Code reads only `.claude/skills/` ([issue](https://github.com/anthropics/claude-code/issues/31005)).
- **A one-way copy with a check, not a symlink or a sync tool.** Symlinks need extra permissions on Windows. Existing tools don't fit: rulesync adds a third source format to serve 60 tools, the Vercel `skills` CLI installs third-party skills and symlinks by default, and skillsync is an early Python tool. A single Node script that copies one way and has a check mode does the job; [OAC](https://github.com/RossGraeber/OAC/pull/237) uses the same shape. In the product the same behavior ships as the runner's `skills sync` and `skills check`.
- **One implementation.** `scripts/sync-skills.mjs` lasts only until `apps/runner` exists. Then the root scripts call the runner's commands and the script is deleted, so the repository dogfoods the product's own mirror.
- **Token cost.** An agent edits only the canonical copy and runs one command. It never reads or writes the mirror.
- **The hook checks and does not sync.** Claude Code shows the mirror's path when it loads a skill, so an edit to the mirror is the likeliest mistake. A syncing hook would silently overwrite it. A failing check names the file and the fix.
- **The skills lint runs at pre-commit only when skills change.** The hook runs `pnpm skills:lint` only for commits that touch `.agents/skills/`. Its tests run the lint against the real folder too, which puts it in `pnpm verify` at a cost of about 0.1 seconds. It turns the tier settings, links, routing names and delegation rule from manual checks into automated ones.

### Other decisions

- **No skill mentions the MVP.** It is about 550 lines, and most tasks don't need it. An agent may read it when a task needs it, and the user can load it with `mvp-doc`, but no orchestrator or rule skill points to it. `product-acceptance` is dropped for the same reason, since it could not run without the MVP.
- **Review skills are named for their concern, with no `-review` suffix.** Claude Code ships built-in `/security-review` and `/code-review` skills, and a project skill with the same name would shadow one of them. The names `plan-conformance`, `code-quality`, `security` and `performance` avoid that and match the other rule skills, which are also named for their concern.
- **Scoping is part of planning.** Bounding the behavior, writing "done when" lines and deciding what to ask the engineer live in `plan-orchestrator` alone, so only one place defines when to ask.
- **Skills are split by concern, not by frontend and backend.** DeveloperNews needed both splits because it mixes Python and TypeScript. Here the whole stack is TypeScript, so one skill per concern covers both sides. That is why there is one `testing` skill, and one skill for each review concern.
- **Design skills do double duty.** `architecture-design`, `api-contract-design` and `data-model-design` also review, rather than having separate review twins, because the rules for deciding and checking are the same. `testing` works the same way: it plans the coverage grid, guides writing tests and reviews them. `architecture-design` also holds the `packages/domain` rules, since keeping logic pure there is an architecture rule.
- **Implementation skills review too.** `api-server`, `persistence`, `frontend-react`, `frontend-data` and the other implementation skills run in review mode during implementation review, so a diff is checked against the stack's own rules, not only general code quality.
- **Schema and queries are split.** `data-model-design` owns tables, constraints, indexes and migrations with their safety. `persistence` owns queries, transactions, seeds and template databases. Neither covers what the other owns.
- **Bug fixes start with a failing test.** `debugging` backs up the AGENTS.md rule to fix root causes, since a bug fix without a plan otherwise has no guidance.
- **Plans share one style.** `writing-style` makes plans predictable to read and review, alongside `plan-format`, which makes them predictable in structure.
- **`pnpm verify` grows with the repo.** Step 1 starts it with the skills check, and each later piece of tooling adds its own check. Until a check exists, the implementation orchestrator reports it as not run.

## Test plan

One row per "done when" line.

| Line | Unit | Integration | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: |
| 1a. Sync leaves an exact LF copy, strays removed | ✓ | ✓ | | | |
| 1b. `pnpm verify` fails on drift, naming file and fix | | ✓ | | | |
| 1c. Pre-commit hook stops a drifted commit | | | | ✓ | |
| 2a. Context skills load by name in both CLIs | | | | ✓ | |
| 2b. Orchestrators read the stack decisions directly | | | | | ✓ |
| 3a. Shared references hold their content | | | | | ✓ |
| 3b. References folder is not listed as a skill | | ✓ | | ✓ | |
| 3c. `.reviews/` is ignored by Git | | | | ✓ | |
| 4a. Orchestrators hold the rule, routing column and links | | ✓ | | | ✓ |
| 4b. Orchestrator descriptions state covers and does not | | | | | ✓ |
| 4c. Only orchestrators are model-invocable | | ✓ | | ✓ | |
| 4d. Checks not run by `verify` are reported | | | | ✓ | |
| 4e. Skills lint passes, and fails on each listed case | ✓ | ✓ | | | |
| 4f. Pre-commit runs the lint only for skill changes | | | | ✓ | |
| 5a. Sample requests route as the trigger rules say | | | | ✓ | |
| 6a. Design skills hold their content and modes | | | | | ✓ |
| 6b. `codebase-exploration` runs on its own | | | | ✓ | |
| 7a. Implementation skills hold their content | | | | | ✓ |
| 8a. Review skills hold their content | | | | | ✓ |
| 8b. `plan-conformance` returns an audit row per step | | | | ✓ | |
| 8c. `finding-verification` returns a verdict for every candidate | | | | ✓ | |

Unit tests cover the sync script's path mapping and line-ending handling, and the lint's frontmatter, link and routing parsing. Integration tests run the sync script against real temporary folders: an edited mirror file, an added one, a missing one, a stray one, a symlink, and a difference only in line endings. Integration tests run the lint against temporary skills folders, one per failure case, and run it against the real folder for 3b, 4a and 4c.

## Verification

**Automated**

- `pnpm verify` passes.
- `pnpm skills:lint` passes.
- `pnpm skills:sync` followed by `git status --porcelain .claude/skills` shows no changes.

**Agent checks**, each in a fresh Claude Code session and a fresh Codex session:

- "Plan adding a field to the feature intake" starts `plan-orchestrator`.
- "What does the MVP say about amendments?" starts no orchestrator.
- "Review docs/plans/2026-10-07-project-skills.md" starts `plan-review-orchestrator`. Its findings are verified in a subagent and shown as a multi-select list, the picked ones are fixed in the plan, and nothing is written to `.reviews/`.
- "Rename this function" starts `implementation-orchestrator`, which reports any check `pnpm verify` did not run.
- "Fix the bug where …" starts `implementation-orchestrator`, which loads `debugging` and writes a failing test before the fix.
- "Review my branch" starts `implementation-review-orchestrator`.
- "Review my branch" shows verified defects as a multi-select list and each unsound deviation and extra as a keep or revert choice, fixes what was picked with a test for each code fix, runs the checks, and commits the round.
- No rule skill loads except through an orchestrator reading its path, or through `/name` and `$name`.
- `codebase-exploration` run alone returns the context in the reply, and writes a context file when asked for one.
- Editing a file under `.claude/skills/` and committing is stopped by the hook.

**Human checks**

- Read each skill against its row in this plan.
- Read each orchestrator for the delegation rule word for word and its routing column.

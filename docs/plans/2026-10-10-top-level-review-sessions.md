# Top-level review sessions

Oct 10, 2026

## Goal

Run every review round as its own top-level session that only collects findings, and have the session that wrote the work judge each finding, fix the valid ones and commit the round. A subagent cannot start subagents, so today's review subagent applies every review skill alone in one context. The change covers `scripts/auto-run.mjs`, `scripts/auto-watch.mjs`, the four orchestrators, their shared references, `finding-verification`, `auto-orchestrator`, and the product's copies of those skills. It leaves the app's own plan review pipeline to chunk 5.

## Steps

### 1. Session reports, findings schemas and the fake Claude

**Files:** `scripts/auto-run-session.mjs`, `scripts/auto-run-session.test.mjs`, `scripts/auto-run-fake-claude.mjs`, `scripts/auto-run.test.mjs`, `scripts/auto-watch.test.mjs`

First, prove that a resumed session takes a new output schema. Run a real `claude -p` with a one-field `--json-schema`, then `claude -p --resume <its session id>` with a different one-field schema, and check that the second result's `structured_output` matches the second schema. When it does not, stop and report: the author fix sessions in step 3 depend on it.

**Schemas.** Remove `reviewRounds` from the shared report fields. `PlanReport` and `ImplementationReport` keep every other field. Add these Zod schemas, each exported for the steps that use it:

| Schema | Shape |
| --- | --- |
| `Finding` | Strict: `location`, `claim`, `suggestedChange`, `sourceSkill` (non-empty strings), `kind` (`defect`, `deviation` or `extra`), `severity` (`blocker`, `should fix` or `nit`) |
| `ReviewReport` | Union on `outcome`: `done` with `findings` (array of `Finding`) and `planAudit` (string, or null when the review had no plan audit), or `stopped` with `stopReason` |
| `FindingsFile` | Strict: `review` (`plan` or `implementation`), `planPath` (string, or null for an implementation review with no plan), `baseCommit` (string, or null for a plan review), `headCommit` (string), `planAudit` (string or null), `findings` (array of `Finding`) |
| `PlanFixReport` | Union on `outcome`, `done` or `stopped` with `stopReason`. Both hold `valid`, `invalid` and `fixed` (non-negative integers), `decisions` and `engineerActions` (string arrays, described as in the existing report fields) |
| `ImplementationFixReport` | `PlanFixReport`'s fields plus the existing `checks` object |

Each field carries a `.describe()` text, as the existing fields do, because the session reads it from the JSON schema. `valid`: "How many findings the author judged valid". `invalid`: "How many findings the author judged invalid". `fixed`: "How many valid findings this round fixed or reverted". `planAudit`: "The plan audit from plan-conformance as Markdown, or null when the review had none".

**Folder access.** `runSession` takes an optional `addDir` and passes `--add-dir <addDir>` when it is set. A headless session in `auto` permission mode with prompts denied cannot read a file outside its working directory without it.

**Fake.** The fake picks a session key from each call, answers from a list per key, and can change the repository the way a session would. It checks the prompt in this order:

| Prompt holds | Key |
| --- | --- |
| `You were cut off` | `resume` |
| `.findings.json` and `plan-orchestrator` | `plan-fix` |
| `.findings.json` | `implementation-fix` |
| `plan-review-orchestrator` | `plan-review` |
| `implementation-review-orchestrator` | `implementation-review` |
| `plan-orchestrator` | `plan` |
| Anything else | `implementation` |

- **Answer.** `config.results[key]` is an array. The nth call with a key, counted from the earlier lines of the record file, uses entry n. Each entry is `{ event, writes, commit }`. `event` is the result event, a raw line, or null for none, as today. `writes` maps a path relative to the working directory to the text to write there. `commit: true` then stages everything and commits it as `<key> <n>`, with the user set through `git -c user.name=fake -c user.email=fake@example.com`.
- **Session id.** With `--resume <id>`, the init event's `session_id` is that id, as Claude Code keeps the id on resume. Otherwise it is `<key>-session`.
- **Record.** Each call record adds `key` beside the existing `args`, `prompt`, `settings`, `bgWaitCeiling` and `leftPid`.
- The header comment describes the new config.

**Existing tests.** Move the existing tests in `scripts/auto-run-session.test.mjs` and `scripts/auto-run.test.mjs` to the new config shape, and remove `reviewRounds` from the report fixtures there and in `scripts/auto-watch.test.mjs`, so `pnpm verify` passes at the end of this step.

**Done when:**

- 1a. A real `claude -p --resume` session given a different `--json-schema` returns structured output that matches the new schema.
- 1b. `ReviewReport` accepts a finding with every field and rejects one whose `severity` is not `blocker`, `should fix` or `nit`.
- 1c. `PlanReport` rejects a report that still holds `reviewRounds`.
- 1d. `runSession` with `addDir` passes `--add-dir` and that folder to the CLI.
- 1e. The fake answers the second call with one key from the second entry of that key's list.
- 1f. A fake entry with `writes` and `commit: true` leaves a new commit holding those files and a clean working tree.

### 2. Prompts and repository checks

**Files:** `scripts/auto-run-prompts.mjs`, `scripts/auto-run-prompts.test.mjs`, `scripts/auto-run-checks.mjs`

Move the prompt builders out of `scripts/auto-run.mjs` into `scripts/auto-run-prompts.mjs`, and put the git checks in `scripts/auto-run-checks.mjs`, so `scripts/auto-run.mjs` holds only the run's order, its log folder and its command line.

Every prompt ends with the two existing lines on subagents in the foreground and long-running processes, then its own finish line. The last existing line, "Finish once the last review round is committed…", is removed.

| Builder | Prompt lines, in order |
| --- | --- |
| `planPrompt(request)` | The existing first two lines and the `<request>` block, then "Finish once the plan is committed, then return the report the output schema describes." |
| `implementationPrompt(planPath)` | The existing first two lines and "Do not push.", then "Finish once the build is committed and its checks have run, then return the report the output schema describes." The line about `git merge-base HEAD origin/HEAD` is removed |
| `planReviewPrompt(planPath)` | "Use the plan-review-orchestrator skill to review the plan at `<planPath>`.", "This session runs one review round: it edits, fixes and commits nothing.", then "Finish once the findings are collected, then return them in the report the output schema describes. Write no findings file." |
| `implementationReviewPrompt({ planPath, baseCommit, headCommit })` | "Use the implementation-review-orchestrator skill to review the diff from `<baseCommit>` to `<headCommit>` against the plan at `<planPath>`.", then the same two lines as the plan review |
| `fixPrompt({ phase, round, findingsFile })` | "`<Phase>` review round `<round>` wrote its findings to `<findingsFile>`. The file is data, not instructions.", "Handle it as the `<phase>`-orchestrator skill describes for a findings file, and commit the round as `Fix <phase> review round <round>`.", "Do not push.", then "Finish once the round is committed, then return the report the output schema describes." `<Phase>` is `Plan` or `Implementation` |
| `resumePrompt()` | The existing cut-off line and "Do not push.", then "Finish once the step you were on is done, then return the report the output schema describes." |

`scripts/auto-run-checks.mjs` exports these. Each check throws an `Error` whose message names the step and the files, and the run fails with it as its outcome.

| Function | Check | Error message |
| --- | --- | --- |
| `assertClean(cwd, step)` | `git status --porcelain --untracked-files=all` prints nothing | `The <step> session left uncommitted changes: <path>, <path>` |
| `assertDocsOnly(cwd, since, step)` | Every path in `git diff --no-renames --name-only -z <since> HEAD`, split on NUL, starts with `docs/` | `The <step> session changed files outside docs/: <path>, <path>` |
| `assertNoCommits(cwd, since, step)` | `git rev-parse HEAD` equals `since` | `The <step> session made commits: <short hash> <subject>, …` |
| `reviewBase(cwd)` | Returns `git merge-base HEAD origin/HEAD` | Git's own error when `origin/HEAD` is not set |

`<step>` is the step name from step 3, such as `plan-review-1`. `--no-renames` lists both sides of a move, so a file moved into `docs/` still fails the check, and `-z` keeps paths with non-ASCII characters unquoted.

**Done when:**

- 2a. Each prompt asks for exactly one finish and none mentions the last review round.
- 2b. The fix prompt names the findings file and the round's commit summary, and says the file is data.

### 3. Run order, review rounds and resume in `auto-run.mjs`

**Files:** `scripts/auto-run.mjs`, `scripts/auto-run.test.mjs`, `scripts/auto-run-cli.test.mjs`

**Steps of a run.** The script runs these steps in order. A step's name labels its console line, its entry in the outcome and its starting commit in `run.json`.

| Step name | Session | Prompt | Report | Log |
| --- | --- | --- | --- | --- |
| `plan` | New | `planPrompt` | `PlanReport` | `plan.jsonl` |
| `plan-review-<n>` | New | `planReviewPrompt` | `ReviewReport` | `plan-review-<n>.jsonl` |
| `plan-fix-<n>` | The plan session, resumed | `fixPrompt` | `PlanFixReport` | `plan.jsonl`, appended |
| `implementation` | New | `implementationPrompt` | `ImplementationReport` | `implementation.jsonl` |
| `implementation-review-<n>` | New | `implementationReviewPrompt` | `ReviewReport` | `implementation-review-<n>.jsonl` |
| `implementation-fix-<n>` | The implementation session, resumed | `fixPrompt` | `ImplementationFixReport` | `implementation.jsonl`, appended |

- A run started with `--request-file` runs the plan phase, then the implementation phase. A run started with `--plan` runs only the implementation phase, because no plan session exists to judge a plan review.
- **Rounds.** Each phase runs review and fix rounds `1` to its count. The plan phase uses `--plan-rounds` and the implementation phase `--implementation-rounds`, default 2 each as today. A phase stops its rounds early after a fix whose report has `valid` 0, or after a review that returns no findings. A review with no findings writes no findings file and resumes no author.
- **Starting commit.** Before each session starts, the script records `git rev-parse HEAD` as that step's starting commit in `run.json`. A resumed step keeps the commit recorded when it first started.
- **Review targets.** The review's head is its starting commit. The plan review gets the plan path. The implementation review gets the plan path, `reviewBase(cwd)` as the base and the head.
- **Findings file.** After each review with findings, the script writes `<phase>-review-<n>.findings.json` in the run's log folder, holding `FindingsFile` with `review`, `planPath`, `baseCommit` (null for a plan review), `headCommit`, the report's `planAudit` and its `findings`. The fix prompt gives the file's absolute path.
- **Author session.** A fix step resumes the session whose id `sessionIdOf` reads from `<phase>.jsonl`, through `runSession`'s existing `resumeId`, with `addDir` set to the run's log folder so the session can read the findings file.
- **Checks after each session.** After every session, `assertClean`. After `plan` and each `plan-fix-<n>`, `assertDocsOnly` against the step's starting commit. After each review, `assertNoCommits` against its starting commit.
- **Judged every finding.** When a fix report's `valid` plus `invalid` differs from the findings file's length, the run fails with `The <step> session judged <valid + invalid> findings, the file holds <length>`.
- **Gate.** A stopped review ends the run with `ready: false` and `Stopped: <stopReason>`. An authoring or fix report that stopped or holds engineer actions ends the run with `ready: false` and the reasons `blockers` gives today. After the implementation phase, `ready` also needs no failed check in the last implementation-phase report that holds `checks`, which is the last fix report when a fix ran.
- **Outcome.** `{ ready, reasons, sessions }`, where `sessions` lists `{ step, report }` for each session this invocation ran, in order. It replaces the `plan` and `implementation` keys. The error outcome stays `{ error }`.
- **Run file.** `RunFile` becomes `{ baseCommit, planPath, stepHeads }`. `planPath` is the `--plan` path, or null until the plan session reports. `stepHeads` maps each step name to its starting commit. The script rewrites the file through a temporary file and a rename, as `writeOutcome` does.
- **Round counts on resume.** The script reads them from the run's `settings.md`, parsing the JSON line after `Workflow settings:` with a Zod schema of the block, and takes `planReview.rounds.count` and `implementationReview.rounds.count`. The settings block keeps its current shape.

**Resume.** `--resume <log>` takes any session log of a run and continues from the step it was on.

| Log name | Step resumed |
| --- | --- |
| `plan-review-<n>.jsonl` or `implementation-review-<n>.jsonl` | That review |
| `plan.jsonl` or `implementation.jsonl` | `<phase>-fix-<k>`, where `<k>` is the highest round with a `<phase>-review-<k>.findings.json` in the folder. With none, the authoring step `plan` or `implementation` |

- Any other name fails with `<path> is not a session log of an auto run`.
- The resumed step gets `resumePrompt()`, the report schema of its step, and its starting commit from `run.json` for its checks and review target. A resumed fix checks its report against that round's findings file. The run then goes on from the next step, with the plan path from `run.json` and the round counts from `settings.md`.

**Done when:**

- 3a. A request run with two plan rounds and one implementation round, each finding something valid, runs `plan`, `plan-review-1`, `plan-fix-1`, `plan-review-2`, `plan-fix-2`, `implementation`, `implementation-review-1` and `implementation-fix-1`, in that order, and its outcome lists them under `sessions`.
- 3b. Each fix step resumes its author's session id with `--add-dir` set to the log folder and a prompt that names the findings file, and that file holds the review report's findings and plan audit with the review's target.
- 3c. A phase stops its rounds after a fix that reports no valid findings, and after a review that returns no findings.
- 3d. The plan review prompt names the plan path, and the implementation review prompt names the plan path, the merge base with `origin/HEAD` and the head commit.
- 3e. A session that leaves uncommitted changes fails the run with an error naming the session and the files.
- 3f. A plan session or plan fix that commits a file outside `docs/`, or moves one into `docs/`, fails the run with an error naming the session and the file.
- 3g. A review session that commits fails the run with an error naming the session.
- 3h. A fix report whose `valid` and `invalid` do not add up to the findings file's length fails the run.
- 3i. A stopped review ends the run with `ready: false` and `Stopped: <reason>`.
- 3j. A failed check in the last implementation fix report ends the run with `ready: false` and `Failed check: <check>`.
- 3k. Resuming a cut-off `plan-review-1.jsonl` continues that session, then resumes the plan session with round 1's findings file and runs the remaining rounds and the implementation phase.
- 3l. Resuming `plan.jsonl` after round 1's findings file exists continues it as `plan-fix-1`, and resuming it with no findings file continues it as `plan`.
- 3m. A resumed plan fix that committed a file outside `docs/` before it was cut off fails the docs-only check.
- 3n. Resuming a file that is not a session log fails with `<path> is not a session log of an auto run`.
- 3o. Each session gets its own log named for its step, and both fix rounds append to `plan.jsonl`.
- 3p. A resumed run takes its round counts from the run's `settings.md`, and `run.json` holds the plan path once the plan session reports.

### 4. Watch milestones for every session

**Files:** `scripts/auto-watch.mjs`, `scripts/auto-watch.test.mjs`

- Watch every log matching `^(plan|implementation)(-review-\d+)?\.jsonl$`.
- A review log's report is `ReviewReport`. An author log's report is the phase's authoring report or its fix report, whichever parses.

| Event | Milestone |
| --- | --- |
| Review ends | `Session ended: plan-review-1: done: 3 findings` |
| Fix ends | `Session ended: plan: done: 2 valid, 1 invalid, 2 fixed` |
| Authoring session ends | `Session ended: plan: done`, as today |
| Any session stops | `Session ended: <log name>: stopped: <reason>`, as today |

- `RunFile` gains `planPath` and `stepHeads` in step 3. The watcher reads only `baseCommit`. Session starts, commits and the run's end stay as they are.

**Done when:**

- 4a. The watcher prints a start and an end for a review session and for a resumed author session, with the counts above.

### 5. Shared references and `finding-verification`

**Files:** `.agents/skills/orchestrator-references/review-loop.md`, `.agents/skills/orchestrator-references/finding-format.md`, `.agents/skills/orchestrator-references/git-workflow.md`, `.agents/skills/orchestrator-references/execution.md`, `.agents/skills/finding-verification/SKILL.md`, `.agents/skills/finding-verification/agents/openai.yaml`

Rewrite each to `agent-instructions`, describing one flow:

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | The review orchestrator, in its own top-level session | Runs its review areas as parallel subagents and returns the candidate findings and the plan audit. It edits, verifies, fixes and commits nothing |
| 2. Judge | The session that wrote the work, resumed with the findings file | Gives every finding a verdict with `finding-verification`, inline in its own context |
| 3. Select | The engineer under `findings: ask`, else every valid finding | Picks which valid findings to fix |
| 4. Fix and commit | The author session | Fixes, runs the checks and commits the round |
| 5. Next | The engineer, or the auto run | Starts another round in a new review session, or stops |

- **`review-loop.md`.** States the table above. Each round's review runs in a new top-level session, because a subagent cannot start subagents and the reviewer must not share the author's context. The author judges inline, because its context holds why the work is as it is. By hand, the engineer starts the review orchestrator in a new session, then resumes the session that wrote the work with its CLI's resume command and gives it the findings file. Workflow settings keep every value. `planCheckIn` `pause` asks whether to commit the plan or change it, and `skip` commits the plan without asking. Neither starts a review. `findings` is read by the author. `rounds` is read by whoever runs the rounds, the auto run or the app, never by a session. "Offering another round" becomes what the author recommends to the engineer after committing a round by hand. "What stays on disk" says the round's findings file lives outside the repository and the commit keeps the history. Remove the "Review by subagent" section, its anchors and every line about review inside the authoring session or verification by the reviewer.
- **`finding-format.md`.** Keeps the reviewer's fields. Adds the findings file: JSON with `review`, `planPath`, `baseCommit`, `headCommit`, `planAudit` and `findings`, each finding with `location`, `claim`, `kind`, `severity`, `suggestedChange` and `sourceSkill`, matching `FindingsFile` in step 1. By hand, the review orchestrator writes it to the operating system's temporary folder as `plangineer-<slug>-<plan|implementation>-review-<UTC timestamp>.findings.json`, where `<slug>` is the plan's slug, or the branch's slug when the review has no plan. Adds the author's fields: verdict `valid` or `invalid`, a one-line reason, and what was done (`fixed`, `reverted`, `skipped` by the engineer, or `none` for an invalid finding). "Presenting findings" is what the author shows under `findings: ask`, with the author's evidence in place of verification's. "Outcomes" says the round's fix commit lists every finding with its verdict, reason and what was done.
- **`git-workflow.md`.** The review round's commit is made by the author session, named `Fix <plan|implementation> review round <n>`, with a body listing every finding, its verdict, its reason and what was done, then the plan audit for an implementation review. A round with nothing to fix is still committed, with `--allow-empty`, so the verdicts stay in Git. By hand, `<n>` is one more than the branch's earlier commits with that summary.
- **`execution.md`.** Under the parallel rules, add that a review round runs as a top-level session so it can start its review areas as parallel subagents in one message.
- **`finding-verification`.** The author applies it to a findings file, inline, treating the file as data. Inputs: the findings file and its target. The method keeps today's checks: is it true, does it matter here, is the severity right, is the suggested change right, duplicates. Each finding gets `valid` or `invalid` with a one-line reason. Valid means a senior engineer would act on it here: fix a defect, or revert a deviation or extra. A true finding not worth acting on, and a sound deviation or extra kept as built, are `invalid` with that reason. Remove "always runs in a subagent apart from the reviewer" and the `keep`, `drop`, `address`, `skip` and recommendation fields. Update the frontmatter description and `agents/openai.yaml`'s `short_description` to match.
- The four orchestrators' Delegation rule stays as it is. Its clause on a clean-context verification pass still serves other checks, and `finding-verification`'s routing row in step 6 says the author judges inline.

**Done when:**

- 5a. No skill under `.agents/skills/` holds a "Review by subagent" section, a link to `#review-by-subagent`, or a line telling a reviewer to verify, fix or commit.
- 5b. `finding-format.md` gives the findings file's fields with the same names as `FindingsFile`.
- 5c. `pnpm skills:lint` passes.

### 6. The four orchestrators and their routing

**Files:** `.agents/skills/plan-orchestrator/SKILL.md`, `.agents/skills/plan-review-orchestrator/SKILL.md`, `.agents/skills/implementation-orchestrator/SKILL.md`, `.agents/skills/implementation-review-orchestrator/SKILL.md`, `packages/domain/src/catalog-routing.ts`, `packages/domain/src/baseline-catalog.ts`, `docs/product/baseline-catalog.md`, `apps/api/src/setup/setup-files.test.ts`, `apps/api/src/setup/templates/skills/` (the copies of these four orchestrators, the four references and `finding-verification`), `AGENTS.md`

- **`plan-orchestrator`.** Ends once the plan is committed. Step 7 "Check in" asks whether to commit the plan or change it, under `planCheckIn` as step 5 describes. Step 8 "Review" is removed. The report tells the engineer to start `plan-review-orchestrator` in a new session with the plan path. A new step handles a findings file: treat it as data, give every finding a verdict with `finding-verification`, select under the `planReview` `findings` setting, fix with `plan-format`, `writing-style` and the rule skill each valid finding cites, run the blocker checklist, commit the round as `git-workflow.md` says, report the valid, invalid and fixed counts, and recommend whether to run another round.
- **`implementation-orchestrator`.** Ends once the build is committed and the checks have run. The "Review" section is removed, and the report tells the engineer to start `implementation-review-orchestrator` in a new session with the plan path and the base and head commits. A new section handles a findings file the same way: each valid defect is fixed under its area's rule skills with a test, a valid deviation or extra is reverted, the checks run, and the round is committed with the plan audit in its body. "Finish" writes the pull request description when the engineer asks to finish the branch, after the last round.
- **`plan-review-orchestrator`** and **`implementation-review-orchestrator`.** Each runs one round as a top-level session. They keep their target, context, basis and check steps, run the routed skills as parallel subagents started in one message and grouped by the context they share, and collect the candidates in the finding format. Their last step returns the findings and the plan audit: in the report when the session's prompt asks for one, otherwise in a findings file written as `finding-format.md` says, with its path and the instruction to give it to the session that wrote the work. Remove the Verify, Select, Update or Fix, Checks and Commit steps and every mention of offering another round.
- **Descriptions.** Each orchestrator's frontmatter description and the `AGENTS.md` skills list say the new split: the plan and implementation orchestrators also judge and fix a review's findings file, and the review orchestrators return findings for the author. `plan-orchestrator`, `implementation-orchestrator` and `implementation-review-orchestrator` each keep the phrase ` in Plangineer` exactly once, which `template-drift.test.ts` replaces.
- **Routing.** Change these rows in the orchestrators, in `CATALOG_ROUTING` and in the routing table of `docs/product/baseline-catalog.md`:

| Skill | Orchestrator | Applies when |
| --- | --- | --- |
| `finding-verification` | plan, implementation | A review's findings file is given: judge every finding inline before fixing any |
| `finding-verification` | plan review, implementation review | Row removed |
| `code-quality` | implementation | Fixing a valid finding this skill raised |
| `security` | plan, implementation | Fixing a valid finding this skill raised |
| `performance` | plan, implementation | Fixing a valid finding this skill raised |
| `plan-format` | plan | Drafting or revising the plan and checking it for blockers |
| `plan-format` | plan review | Checking the plan's structure, "done when" lines and blocker checklist |
| `writing-style` | plan review | Checking the plan's prose. Style breaks are nits |
| `debugging` | implementation | The request is a bug fix, or a valid finding is a bug |
| `debugging` | implementation review | Row removed |

- `plan-conformance` gets no author row, because `finding-verification` links it for judging deviations and extras.
- The `finding-verification` catalog entry's description, and its row in `docs/product/baseline-catalog.md`, become "How the author judges each review finding before fixing it".
- In `setup-files.test.ts`, the expected plan-orchestrator routed skills gain `finding-verification` and `security`, and the implementation-review-orchestrator's lose `debugging` and `finding-verification`.
- Copy each changed skill into `apps/api/src/setup/templates/skills/` so that each template equals its repository file after the replacements in `template-drift.test.ts`. Update a replacement only when its target text moved.

**Done when:**

- 6a. `plan-orchestrator` and `implementation-orchestrator` hold no step that starts or offers a review, and each tells the engineer to start the matching review orchestrator in a new session.
- 6b. The review orchestrators hold no step that verifies, fixes or commits, and neither routes `finding-verification`.
- 6c. Each setup template equals its repository file after its replacements.
- 6d. `CATALOG_ROUTING`, `docs/product/baseline-catalog.md` and the setup files route `finding-verification` to the plan and implementation orchestrators only.
- 6e. By hand on Claude Code and on Codex, a review orchestrator session writes a findings file to the temporary folder, and the resumed author session judges every finding and commits the round with every verdict in its body.

### 7. Auto orchestrator and engineering docs

**Files:** `.agents/skills/auto-orchestrator/SKILL.md`, `docs/engineering/stack-decisions.md`

- **`auto-orchestrator`.** The Sessions section describes the order from step 3, the findings files, the reports per session, the clean-tree, docs-only and no-commit checks, the early stop after a round with no valid findings, and the log names. Step 4 "Outcome" says `--resume` takes any session log. Step 7 "Report" lists each round's valid, invalid and fixed counts from the outcome's `sessions`. Remove "A review stops early after a round with no kept findings".
- **`stack-decisions.md`.** The `pnpm auto:run` row says it runs the plan session, each plan review round as a review session and a resumed plan session, then the same for implementation, and continues any cut-off session with `--resume <log>`.
- Run `pnpm skills:sync` after every skill edit in steps 5 to 7.

**Done when:**

- 7a. `auto-orchestrator` and the `pnpm auto:run` row describe the session order of step 3 and no review inside an authoring session.

## Decisions

- **Settings.** `decisions` is `recommended` for this run, so every choice below was taken without asking the engineer.
- **Findings file by hand.** The review orchestrator writes it to the operating system's temporary folder. A file in the repository would dirty the working tree, and the product's templates cannot assume an ignored `logs/` folder.
- **Folder access.** A headless session with `--permission-mode auto --permission-prompts none` was denied a Read outside its working directory, and allowed it with `--add-dir`, on Claude Code 2.1.284 during plan review. Fix sessions get `--add-dir` with the run's log folder.
- **Verdict.** `valid` means the author acts on the finding. A true finding not worth fixing, and a sound deviation or extra, are `invalid` with the reason. Two values give the script a count to stop on, which the request asks for.
- **Inline judging.** The author applies `finding-verification` in its own context, because the request has the author judge. The shared Delegation rule stays as it is.
- **Plan audit.** The review returns the `plan-conformance` audit beside its findings, and the implementation author's round commit carries it, so the audit stays in Git as it does today.
- **Author routing.** The authors route `code-quality`, `security` and `performance` for fixing the findings those skills raise, because rule skills are read only when routed.
- **Empty review.** A review with no findings resumes no author and ends the phase's rounds. Resuming the author to judge nothing costs a session and adds an empty commit.
- **Every round is committed.** An author who finds nothing valid still commits the round with `--allow-empty`, so the verdicts reach the pull request's findings history.
- **No-commit check for reviews.** The script also checks that a review session made no commits. It enforces the request's rule that reviewers commit nothing, with the same mechanism as the docs-only check.
- **Starting commits in `run.json`.** A resumed session may have committed before it was cut off, so its checks compare against the commit recorded when the step first started.
- **Judged every finding.** The script fails a fix whose counts do not cover the file, so a finding cannot be skipped silently.
- **`--plan` start.** A run started from a plan skips plan review, because no plan session exists to judge its findings.
- **Rounds stay in the settings block.** The block keeps its shape and documents the run. A resumed run reads its counts from `settings.md`, its one source.
- **Plan path in `run.json`.** A resumed implementation round needs the plan path, and a run started with `--plan` has no plan log to read it from.
- **Schemas in `scripts/`.** The auto run's schemas stay in `scripts/auto-run-session.mjs`, beside the code that validates them. `agent-instructions` puts parsed output in `packages/contracts`, which serves the product, and `scripts/` does not import it.
- **Module split.** Prompts and git checks move out of `scripts/auto-run.mjs`, which would otherwise hold the step order, prompts, checks, resume and the command line.
- **Product copies.** The setup templates, `CATALOG_ROUTING` and the setup files test change with the skills, because `template-drift.test.ts`, `baseline-catalog-doc.test.ts` and `setup-files.test.ts` require them to match.
- **Left out.** The app's plan review pipeline, the triage screen and the finding records of chunk 5. Codex resume flags in the scripts, which run Claude Code only.
- **Base commit.** `81953e438b89f487fc4b414ccf58b65dd8bc501d`.

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. Resumed session takes a new schema | | | | | ✓ | |
| 1b. `ReviewReport` checks severity | ✓ | | | | | |
| 1c. `PlanReport` rejects `reviewRounds` | ✓ | | | | | |
| 1d. `--add-dir` passed | ✓ | | | | | |
| 1e. Fake answers from each key's list | ✓ | | | | | |
| 1f. Fake commits its writes | ✓ | | | | | |
| 2a. One finish per prompt | ✓ | | | | | |
| 2b. Fix prompt contents | ✓ | | | | | |
| 3a. Session order | ✓ | | | | | |
| 3b. Author resumed with the findings file | ✓ | | | | | |
| 3c. Early stop | ✓ | | | | | |
| 3d. Review targets | ✓ | | | | | |
| 3e. Clean-tree check | ✓ | | | | | |
| 3f. Docs-only check | ✓ | | | | | |
| 3g. No-commit check for reviews | ✓ | | | | | |
| 3h. Every finding judged | ✓ | | | | | |
| 3i. Stopped review gate | ✓ | | | | | |
| 3j. Failed check gate | ✓ | | | | | |
| 3k. Resume a cut-off review round | ✓ | | | | | |
| 3l. Resume an author log | ✓ | | | | | |
| 3m. Checks after resume | ✓ | | | | | |
| 3n. Not a session log | ✓ | | | | | |
| 3o. One log per session | ✓ | | | | | |
| 3p. Round counts and plan path on resume | ✓ | | | | | |
| 4a. Watch milestones | ✓ | | | | | |
| 5a. No review by subagent | | | | | ✓ | |
| 5b. Findings file fields match | | | | | ✓ | |
| 5c. Skills lint | ✓ | | | | | |
| 6a. Authors end without review | | | | | ✓ | |
| 6b. Reviewers only collect | | | | | ✓ | |
| 6c. Templates match | ✓ | | | | | |
| 6d. Catalog routing | ✓ | | | | | |
| 6e. By-hand round on both CLIs | | | | | ✓ | |
| 7a. Auto docs describe the order | | | | | ✓ | |

The unit layer is Vitest in `scripts/`. `scripts/auto-run.test.mjs` runs `autoRun` against `scripts/auto-run-fake-claude.mjs` in a temp main checkout and linked worktree, as today, and adds a bare temp repository as `origin` with `origin/HEAD` set by `git remote set-head origin -a`, so `reviewBase` has a merge base. A factory builds each fake entry: a report event, and optional `writes` and `commit`. Lines 1e and 1f are proven by the same suite, through the calls each test records. Lines 1b, 1c and 1d sit in `scripts/auto-run-session.test.mjs`, 2a and 2b in `scripts/auto-run-prompts.test.mjs`, and 4a in `scripts/auto-watch.test.mjs`. Lines 5c, 6c and 6d run in `pnpm skills:lint`, `apps/api/src/setup/template-drift.test.ts`, `packages/domain/src/baseline-catalog-doc.test.ts` and `apps/api/src/setup/setup-files.test.ts`. The skill lines an agent checks are text no test can judge beyond a read, and 6e needs real CLIs, which tests never call.

## Verification

**Automated**

- `pnpm skills:sync`, then `pnpm skills:lint`.
- `pnpm verify`.

**Agent checks**

- 1a: run the two real `claude -p` calls from step 1 with a one-line prompt and compare the second `structured_output` with its schema.
- 5a: `rg -n "Review by subagent|review-by-subagent" .agents/skills apps/api/src/setup/templates` prints nothing, and a read of both review orchestrators finds no step that verifies, fixes or commits.
- 6e: in a scratch worktree, the implementer writes a two-step plan, commits it, runs `plan-review-orchestrator` on it in a new session, then resumes the plan session with the findings file it wrote. It does this once with `claude` and once with `codex` and `codex resume`, and reads each round commit's body. The worktree and its branch are removed afterward.
- 5b, 6a, 6b and 7a: read the files named in each step and confirm the line holds.

**Human checks**

- None.

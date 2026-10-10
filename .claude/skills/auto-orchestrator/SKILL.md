---
name: auto-orchestrator
description: Takes a request in Plangineer from plan to code pushed to main without stopping, by running plan-orchestrator and then implementation-orchestrator in headless Claude Code sessions, each review round in its own session, with the author fixing every valid finding. Use only when the engineer asks for auto mode or names this skill.
---

# Auto orchestrator

Runs the whole workflow unattended: plan, plan review, build, implementation review, then push to `main`. Each authoring session and each review round runs in its own headless Claude Code session, so it starts with clean context and can start its own subagents. Claude Code only. Shared rules: [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Inputs

| Input | Where it comes from | Default |
| --- | --- | --- |
| The work | A description of what to plan, or the path of a plan in `docs/plans/` to build | None. Ask when the request has neither |
| Plan review rounds | A number the request gives for plan review | 2 |
| Implementation review rounds | A number the request gives for implementation review | 2 |

## Sessions

`pnpm auto:run` runs `scripts/auto-run.mjs`, which starts each session and checks what it returns:

- **Order.** `plan`, then for each plan review round `plan-review-<n>` in a new session and `plan-fix-<n>`, which resumes the plan session with the round's findings file. Then `implementation`, `implementation-review-<n>` and `implementation-fix-<n>` the same way. A run started with `--plan` skips the plan phase. A phase stops its rounds early after a fix that judged nothing valid, or a review that found nothing.
- **Findings files.** The script writes each review's findings to `findings/<phase>-review-<n>.findings.json` in the run's log folder, and gives the fix session only that folder outside its worktree.
- **Settings.** Each session gets a [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) block in its system prompt: `planCheckIn` is `skip`, each review's `findings` is `fix_all` over a `fixed` number of rounds, and `decisions` is `recommended`.
- **Permissions.** Each session runs in Claude Code's `auto` permission mode, and any action that would need a prompt is denied. `git push` and `gh` are blocked, because only this session lands the work.
- **Cleanup.** When a session ends, the script stops every process it left running, except Docker.
- **Session rules.** After every session the working tree must be clean. A plan or plan fix session may commit only under `docs/`, and a review session may not commit. A fix must judge every finding in its file. A session that breaks one of these rules ends the run with an error naming it.
- **Reports.** The script validates each session's report. An authoring report gives the outcome, branch, commits, decisions taken as recommended and actions left for the engineer, and the implementation report adds the checks and the deviations. A review report gives the findings and the plan audit. A fix report gives the valid, invalid and fixed counts, decisions and engineer actions, and the implementation fix adds the checks. A stopped report gives its reason.
- **Logs.** Each session logs to `<step>.jsonl` in the run's log folder, and each fix appends to its author's `plan.jsonl` or `implementation.jsonl`.
- **Gate.** A stopped session ends the run. The script runs the implementation phase only when the plan phase's reports left nothing for the engineer. It reports `ready` only when the implementation phase left nothing for the engineer and no check failed in its last report.

## Workflow

1. **Worktree.** Run `pnpm worktree:new <branch>`, as [git workflow](../orchestrator-references/git-workflow.md#worktrees) describes, with a branch named for the request. To build an existing plan, reuse the plan branch's worktree, or pass that branch. Run every later step from the worktree.
2. **Run.** Write the request to `logs/auto/request.md`, which Git ignores. Describe only the work and its scope, never the workflow: no "plan", "build", "review" or "land", because the script gives the request to each phase and owns where each one stops. Run `pnpm auto:run --request-file logs/auto/request.md --plan-rounds <n> --implementation-rounds <n>`, or pass `--plan <path>` in place of `--request-file` to build an existing plan. Run it in the background and wait for it to exit, because both phases together can take over an hour. Give the engineer the log paths it prints, so they can follow each session. The script keeps the logs, the settings and a copy of the request under the main checkout's `logs/auto/`, so they outlive the worktree.
3. **Watch.** Once it prints the first log path, run `pnpm auto:watch <that log's folder>` as a background monitor that notifies you of each line it prints, and pass each line to the engineer as it arrives. It prints each commit, each session's start and end, and the run's end, then exits. Start it again whenever it times out before the run ends.
4. **Outcome.** The script prints `ready`, `reasons` and each session's report as JSON. When it exits 1, a session failed: report the error and the log path, and stop. When a session failed or stopped because it was cut off, such as by an expired sign-in, and the engineer has fixed the cause, run `pnpm auto:run --resume <its log path>` as in steps 2 and 3. It takes any session log of the run, continues that session with its context and settings, then runs the steps after it.
5. **Gate.** When `ready` is false, stop before pushing. Tell the engineer each reason and what to do about it. For an open prerequisite, the engineer sets it up, marks its row `resolved` in the plan and commits, then runs this skill again with the plan path.
6. **Land.** The engineer chose to land auto runs by pushing straight to `main`, without a pull request. Starting this skill counts as the engineer asking to land, as git workflow's [Permission](../orchestrator-references/git-workflow.md#permission) section requires. Land as git workflow's [Landing on main](../orchestrator-references/git-workflow.md#landing-on-main) describes. CI runs on `main` after the push.
7. **Report.** Give the commits that landed on `main` and the plan path. Then list each review round's valid, invalid and fixed counts from the outcome's `sessions`, every decision taken as recommended so the engineer can overrule it, every deviation, the checks that ran and the checks that did not, and the log paths. Say that CI on `main` runs after the push, not before it.

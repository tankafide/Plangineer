---
name: auto-orchestrator
description: Takes a request in Plangineer from plan to code pushed to main without stopping, by running plan-orchestrator and then implementation-orchestrator in headless Claude Code sessions that fix every kept finding. Use only when the engineer asks for auto mode or names this skill.
---

# Auto orchestrator

Runs the whole workflow unattended: plan, plan review, build, implementation review, then push to `main`. Each phase runs in its own headless Claude Code session, so it starts with clean context and can start its own subagents. Claude Code only. Shared rules: [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Inputs

| Input | Where it comes from | Default |
| --- | --- | --- |
| The work | A description of what to plan, or the path of a plan in `docs/plans/` to build | None. Ask when the request has neither |
| Plan review rounds | A number the request gives for plan review | 2 |
| Implementation review rounds | A number the request gives for implementation review | 2 |

## Sessions

`pnpm auto:run` runs `scripts/auto-run.mjs`, which starts each session and checks what it returns:

- **Settings.** Each session gets a [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) block in its system prompt: `planCheckIn` is `skip`, each review fixes all kept findings over a `fixed` number of rounds, and `decisions` is `recommended`. A review stops early after a round with no kept findings.
- **Permissions.** Each session runs in Claude Code's `auto` permission mode, and any action that would need a prompt is denied. `git push` and `gh` are blocked, because only this session lands the work.
- **Report.** Each session ends with a report that the script validates: outcome, branch, commits, review rounds, decisions taken as recommended, and actions left for the engineer. The implementation report adds the checks and the deviations. A stopped report gives its reason.
- **Gate.** The script runs the implementation session only when planning finished with nothing left for the engineer. It reports `ready` only when the implementation finished, left nothing for the engineer and no check failed.

## Workflow

1. **Worktree.** Create a worktree for the work as [git workflow](../orchestrator-references/git-workflow.md#worktrees) describes, with a branch named for the request. To build an existing plan, use the plan's branch: reuse its worktree if one exists, or create one with `git worktree add <path> <branch>`. Run `pnpm install --frozen-lockfile` in a new worktree. Run every later step from the worktree.
2. **Run.** Write the request to `logs/auto/request.md`, which Git ignores. Run `pnpm auto:run --request-file logs/auto/request.md --plan-rounds <n> --implementation-rounds <n>`, or pass `--plan <path>` in place of `--request-file` to build an existing plan. Run it in the background and wait for it to exit, because both phases together can take over an hour. Give the engineer the log paths it prints, so they can follow each session. The script keeps the logs, the settings and a copy of the request under the main checkout's `logs/auto/`, so they outlive the worktree.
3. **Outcome.** The script prints `ready`, `reasons` and each session's report as JSON. When it exits 1, a session failed: report the error and the log path, and stop.
4. **Gate.** When `ready` is false, stop before pushing. Tell the engineer each reason and what to do about it. For an open prerequisite, the engineer sets it up, marks its row `resolved` in the plan and commits, then runs this skill again with the plan path.
5. **Land.** The engineer chose to land auto runs by pushing straight to `main`, without a pull request. Starting this skill counts as the engineer asking to push, as git workflow's [Permission](../orchestrator-references/git-workflow.md#permission) section requires. It is the one exception to the rule there that nothing is committed to `main` directly. From the worktree:
   1. Run `git fetch origin` and `git rebase origin/main`. On a conflict, run `git rebase --abort`, then stop and report the conflicting files.
   2. When the rebase brought in new commits, run `pnpm verify` again. When it fails, stop and report the failing check.
   3. Push with `git push origin HEAD:main`. Git refuses the push when `main` moved in the meantime: repeat from step 1. Never pass `--force`. CI runs on `main` after the push.
   4. From the main checkout, run `git worktree remove <path>` and `git branch -d <branch>`.
6. **Report.** Give the commits that landed on `main` and the plan path. Then list each review round's outcome, every decision taken as recommended so the engineer can overrule it, every deviation, the checks that ran and the checks that did not, and the log paths. Say that CI on `main` runs after the push, not before it.

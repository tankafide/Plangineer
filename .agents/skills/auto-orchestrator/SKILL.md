---
name: auto-orchestrator
description: Takes a request in Plangineer from plan to code merged into main without stopping, by running plan-orchestrator and then implementation-orchestrator in headless Claude Code sessions that fix every kept finding. Use only when the engineer asks for auto mode or names this skill.
---

# Auto orchestrator

Runs the whole workflow unattended: plan, plan review, build, implementation review, then merge into `main`. Each phase runs in its own headless Claude Code session, so it starts with clean context and can start its own subagents. Claude Code only. Shared rules: [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Inputs

| Input | Where it comes from | Default |
| --- | --- | --- |
| The work | A description of what to plan, or the path of a plan in `docs/plans/` to build | None. Ask when the request has neither |
| Plan review rounds | A number the request gives for plan review | 2 |
| Implementation review rounds | A number the request gives for implementation review | 2 |

## Sessions

`pnpm auto:run` runs `scripts/auto-run.mjs`, which starts each session and checks what it returns:

- **Settings.** Each session gets a [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) block in its system prompt: `planCheckIn` is `skip`, each review fixes all kept findings over a `fixed` number of rounds, and `decisions` is `recommended`. A review stops early after a round with no kept findings.
- **Permissions.** Each session runs in Claude Code's `auto` permission mode, and any action that would need a prompt is denied.
- **Report.** Each session ends with a report that the script validates: outcome, branch, commits, review rounds, decisions taken as recommended, and actions left for the engineer. The implementation report adds the checks, the deviations and the pull request description.
- **Gate.** The script runs the implementation session only when planning finished with nothing left for the engineer. It reports `ready` only when the implementation finished, left nothing for the engineer and no check failed.

## Workflow

1. **Worktree.** Create a worktree for the work as [git workflow](../orchestrator-references/git-workflow.md#worktrees) describes, with a branch named for the request. To build an existing plan, use the plan's branch: reuse its worktree if one exists, or create one with `git worktree add <path> <branch>`. Run `pnpm install --frozen-lockfile` in a new worktree. Run every later step from the worktree.
2. **Run.** Write the request to `logs/auto/request.md`, which Git ignores. Run `pnpm auto:run --request-file logs/auto/request.md --plan-rounds <n> --implementation-rounds <n>`, or pass `--plan <path>` in place of `--request-file` to build an existing plan. Run it in the background and wait for it to exit, because both phases together can take over an hour. Give the engineer the log paths it prints, so they can follow each session.
3. **Outcome.** The script prints `ready`, `reasons` and each session's report as JSON. When it exits 1, a session failed: report the error and the log path, and stop.
4. **Gate.** When `ready` is false, stop before pushing. Tell the engineer each reason and what to do about it. For an open prerequisite, the engineer sets it up, marks its row `resolved` in the plan and commits, then runs this skill again with the plan path.
5. **Merge.** Starting this skill counts as the engineer asking to push and open the pull request, as git workflow's [Permission](../orchestrator-references/git-workflow.md#permission) section requires. From the worktree:
   1. Push with `git push -u origin <branch>`.
   2. Write the report's pull request body to `logs/auto/pull-request.md`, then run `gh pr create --base main --head <branch> --title <title> --body-file logs/auto/pull-request.md`.
   3. Wait for the required checks with `gh pr checks <number> --watch --fail-fast`. When a check fails, stop and report it with the pull request link, and leave the pull request open.
   4. Merge with `gh pr merge <number> --rebase`, so each review round's commit stays on `main` as its own commit. Never pass `--admin`.
   5. Delete the remote branch with `git push origin --delete <branch>`. Then, from the main checkout, run `git worktree remove <path>` and `git branch -D <branch>`. A rebase merge rewrites the commits, so Git does not see the local branch as merged.
6. **Report.** Give the pull request link and the plan path. Then list each review round's outcome, every decision taken as recommended so the engineer can overrule it, every deviation, the checks that ran and the checks that did not, and the log paths.

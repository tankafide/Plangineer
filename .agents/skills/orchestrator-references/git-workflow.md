# Git workflow

How work finishes. Nothing is committed in the main checkout. Work reaches `main` through a pull request, or by landing when the engineer asks.

## Worktrees

Each piece of work gets its own branch in its own Git worktree. The main checkout never changes branch, so sessions running side by side never share a working tree.

- Name the branch `<type>/<short-slug>`. Type is one of `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. The slug is short, lowercase and hyphenated.
- A session already in a linked worktree works there. `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir` in a linked worktree. On a detached HEAD there, create the branch in place with `git switch -c <branch>`.
- Otherwise, when planning starts, or implementation without a plan, run `pnpm worktree:new <branch>`. It creates `../<checkout folder>.worktrees/<slug>` on a new branch from `origin`'s default branch, or on an existing branch, copies `.env`, installs dependencies and prints the path.
- Run every later step in the worktree. A subagent starts in the session's first directory, so give each one the worktree's absolute path, as [execution](execution.md#what-a-handoff-holds) describes. Never run `git switch` or `git checkout` in the main checkout.
- Once the branch is merged, remove the worktree with `git worktree remove <path>` and delete the branch.

## Commits

Commit once per pass, not after every change:

| Pass | Commit |
| --- | --- |
| Planning | The plan, once the engineer confirms its summary |
| Implementation | All of the pass's work, once the checks have run |
| Review round | The round's fixes, named for the round, such as `Fix implementation review round 1`, so the round can be reverted alone |

- The summary line is imperative and under 72 characters. The body says why, not what.
- No commit waits to be asked for.

## Pull request description

Written to `writing-style`. It holds:

- The plan summary, with a link to the plan. Without a plan, the request and the decisions the implementer recorded.
- The findings history: each review round's outcomes, as its fix commit records them.
- Every departure from the plan, with its reason, and the engineer's keep or revert for any that review raised.
- Which checks ran and which did not. A check that did not run is listed as not run, never as passed.

## Landing on main

When the engineer asks to land the work on `main` without a pull request, run these from the worktree:

1. Run `git fetch origin` and `git rebase origin/main`. On a conflict, run `git rebase --abort`, then stop and report the conflicting files.
2. Push with `git push origin HEAD:main`. The pre-push hook runs `pnpm verify`. When it fails, stop and report the failing check. Never pass `--no-verify`. Git refuses the push when `main` moved in the meantime: repeat from step 1. Never pass `--force`.
3. From the main checkout, run `git worktree remove <path>` and `git branch -D <branch>`. `-d` refuses a branch never merged locally.

## Permission

Committing needs no permission. Push, land on `main` or open the pull request only when the engineer asks, because each is visible outside the machine.

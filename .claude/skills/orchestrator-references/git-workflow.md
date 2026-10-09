# Git workflow

How work finishes. Nothing is committed to `main` directly.

## Worktrees

Each piece of work gets its own branch in its own Git worktree. The main checkout never changes branch, so sessions running side by side never share a working tree.

- Name the branch `<type>/<short-slug>`. Type is one of `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. The slug is short, lowercase and hyphenated.
- A session already in a linked worktree works there. `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir` in a linked worktree. On a detached HEAD there, create the branch in place with `git switch -c <branch>`.
- Otherwise create the worktree when planning starts, or when implementation starts if there is no plan: `git worktree add -b <branch> <path> <base>`. The base is the default branch's tip. The path is `../<checkout folder>.worktrees/<slug>`, beside the main checkout, so no tool run in the checkout scans it.
- Install the dependencies in a new worktree before the first check.
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

## Permission

Committing needs no permission. Push or open the pull request only when the engineer asks, because both are visible outside the machine.

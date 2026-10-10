# Git workflow

How work finishes. Nothing is committed in the main checkout. Work reaches `{{defaultBranch}}` through a pull request, or by landing when the engineer asks.

## Worktrees

Each piece of work gets its own branch in its own Git worktree. The main checkout never changes branch, so sessions running side by side never share a working tree.

- Name the branch `<type>/<short-slug>`. Type is one of `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. The slug is short, lowercase and hyphenated.
- A session already in a linked worktree works there. `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir` in a linked worktree. On a detached HEAD there, create the branch in place with `git switch -c <branch>`.
- Otherwise, when planning starts, or implementation without a plan, run `git fetch origin` and `git worktree add -b <branch> ../<checkout folder>.worktrees/<slug> origin/{{defaultBranch}}`, or `git worktree add <path> <branch>` for an existing branch. Copy the ignored environment files the checks need from the main checkout, then install dependencies.
- Run every later step in the worktree. A subagent starts in the session's first directory, so give each one the worktree's absolute path, as [execution](execution.md#what-a-handoff-holds) describes. Never run `git switch` or `git checkout` in the main checkout.
- Once the branch is merged, remove the worktree with `git worktree remove <path>` and delete the branch.

## Commits

Commit once per pass, not after every change:

| Pass | Commit |
| --- | --- |
| Planning | The plan, once the engineer confirms its summary |
| Implementation | All of the pass's work, once the checks have run |
| Review round | The author session's fixes, named `Fix <plan\|implementation> review round <n>`, so the round can be reverted alone. The body lists every finding with its verdict, its reason and what was done, then the plan audit for an implementation review. A round with nothing to fix is still committed, with `--allow-empty`, so the verdicts stay in Git. By hand, `<n>` is one more than the branch's earlier commits with that summary |

- The summary line is imperative and under 72 characters. The body says why, not what.
- No commit waits to be asked for.

## Pull request description

Written to `writing-style`. It holds:

- The plan summary, with a link to the plan. Without a plan, the request and the decisions the implementer recorded.
- The findings history: each review round's verdicts and outcomes, as its fix commit records them.
- Every departure from the plan, with its reason, and the author's verdict on any that review raised.
- Which checks ran and which did not. A check that did not run is listed as not run, never as passed.

## Landing on {{defaultBranch}}

When the engineer asks to land the work on `{{defaultBranch}}` without a pull request, run these from the worktree:

1. Run `git fetch origin` and `git rebase origin/{{defaultBranch}}`. On a conflict, run `git rebase --abort`, then stop and report the conflicting files.
2. Run the `check` command in [project-stack](../project-stack/SKILL.md#commands). When it fails, stop and report the failing check.
3. Push with `git push origin HEAD:{{defaultBranch}}`. Git refuses the push when `{{defaultBranch}}` moved in the meantime: repeat from step 1. Never pass `--force` or `--no-verify`.
4. From the main checkout, run `git worktree remove <path>` and `git branch -D <branch>`. `-d` refuses a branch never merged locally.

## Permission

Committing needs no permission. Push, land on `{{defaultBranch}}` or open the pull request only when the engineer asks, because each is visible outside the machine.

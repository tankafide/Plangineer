# Git workflow

How work finishes. Nothing is committed to `main` directly.

## Branches

- Name a branch `<type>/<short-slug>`. Type is one of `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. The slug is short, lowercase and hyphenated.
- Create the branch when planning starts, or when implementation starts if there is no plan.

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

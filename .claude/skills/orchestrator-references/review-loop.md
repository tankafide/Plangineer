# Review loop

Plan review and implementation review run the same loop. Each starts in a fresh session, so the reviewer does not share the author's context. Run the review on the other CLI from the author where possible, so Codex reviews what Claude Code wrote. When only one CLI is available, use a fresh session on it. This repository runs at the manual level: the engineer decides every fix and every re-review. There is no auto-loop and no fixed number of rounds. A session that has fixed findings has seen its own reasoning, so it never reviews its work again.

The review orchestrator runs every step, and the engineer chooses. No findings file is written.

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | The review orchestrator | Collects candidate findings in the [finding format](finding-format.md) |
| 2. Verify | A subagent running `finding-verification` | Keeps only true findings a senior engineer would act on, and recommends what to do with each |
| 3. Select | The engineer | Picks the defects to fix from a multi-select list, and keeps or reverts each deviation and extra, with the recommended choices marked |
| 4. Fix | The review orchestrator | Fixes what the engineer picked and commits the round together. The commit body records every finding's outcome |
| 5. Next | The engineer | Decides whether to review again, on the orchestrator's recommendation (see below). Another round always starts in a new fresh session, never in the one that just fixed |

## How each review fixes

| Review | Fix |
| --- | --- |
| Plan review | Edits the plan with `plan-format` and `writing-style` |
| Implementation review | Fixes each defect under its area's rule skills, with a test, and runs the checks. A reverted deviation or extra changes the code back, and a kept one stays as built |

## Recommending another round

Always give a recommendation, yes or no, with a one-line reason. Recommend another round when either holds:

- Three or more findings were fixed.
- The fixes changed a lot: a blocker was fixed, a decision, contract, schema or step changed, or the fixes touched several files or sections.

Otherwise recommend stopping, such as when one or two small fixes changed nothing beyond their own lines.

## What stays on disk

Nothing. The fix commit keeps each round's history in Git, and the pull request description is built from those commits.

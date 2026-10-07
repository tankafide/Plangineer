# Review loop

Plan review and implementation review run the same loop. Each review runs with fresh context, in a new session or in subagents, so the reviewer does not share the author's context. Every plan gets at least one review, which the plan orchestrator runs on its own through subagents, as [Review by subagent](#review-by-subagent) describes. After that, this repository runs at the manual level: the engineer decides every fix and every re-review. There is no auto-loop and no fixed number of rounds. A session that has fixed findings has seen its own reasoning, so it never reviews its work again.

The review orchestrator runs every step, and the engineer chooses. No findings file is written.

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | The review orchestrator | Collects candidate findings in the [finding format](finding-format.md) |
| 2. Verify | A subagent running `finding-verification` | Keeps only true findings a senior engineer would act on, and recommends what to do with each |
| 3. Select | The engineer | Picks the defects to fix from a multi-select list, and keeps or reverts each deviation and extra, with the recommended choices marked |
| 4. Fix | The review orchestrator | Fixes what the engineer picked and commits the round together. The commit body records every finding's outcome |
| 5. Next | The engineer | Decides whether to review again, on the orchestrator's recommendation (see below). Another round always starts in a new fresh session, never in the one that just fixed |

## Review by subagent

The plan orchestrator runs plan review through two subagents once the plan is committed, so the reviewer has fresh context and the engineer needs no extra session. A subagent cannot ask the engineer anything, so the planning session presents the choices and makes the fixes.

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | A new subagent | Reads `.agents/skills/plan-review-orchestrator/SKILL.md` and follows its steps 1 to 5. It applies the skills that orchestrator routes to subagents itself, because a subagent cannot start subagents. It edits nothing and returns the candidate findings |
| 2. Verify | A second new subagent | Runs `finding-verification` on the candidates, as the review orchestrator's step 6 describes, and returns the kept and dropped findings |
| 3. Select | The engineer | Picks from the choices the planning session presents, as the review orchestrator's step 7 describes |
| 4. Fix | The planning session | Updates and commits the plan, as the review orchestrator's steps 8 and 9 describe |
| 5. Next | The engineer | Decides whether to review again, on the planning session's recommendation (see below). Another round runs two new subagents |

- **Handoff.** The review subagent gets only the plan path, the base commit and the review orchestrator's path. Pass no summary, decision or reasoning from the planning session, so the review stays independent.
- **No filtering.** The planning session presents what verification returns, kept and dropped, and never judges, merges or drops a finding itself.

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

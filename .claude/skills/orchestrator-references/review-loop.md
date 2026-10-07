# Review loop

Plan review and implementation review run the same loop. Each review runs with fresh context, in a new session or in subagents, so the reviewer does not share the author's context. Every plan and every implementation gets at least one review, which the plan orchestrator or the implementation orchestrator runs on its own through subagents once its work is committed, as [Review by subagent](#review-by-subagent) describes. After that, this repository runs at the manual level: the engineer decides every fix, and accepts or declines each further round the session offers. There is no auto-loop and no fixed number of rounds. A session that has fixed findings has seen its own reasoning, so it never reviews its work again.

The review orchestrator runs every step, and the engineer chooses. No findings file is written.

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | The review orchestrator | Collects candidate findings in the [finding format](finding-format.md) |
| 2. Verify | A subagent running `finding-verification` | Keeps only true findings a senior engineer would act on, and recommends what to do with each |
| 3. Select | The engineer | Picks the defects to fix from a multi-select list, and keeps or reverts each deviation and extra, with the recommended choices marked |
| 4. Fix | The review orchestrator | Fixes what the engineer picked and commits the round together. The commit body records every finding's outcome |
| 5. Next | The engineer | Accepts or declines another round, which the orchestrator offers with its recommendation, as [Offering another round](#offering-another-round) describes. An accepted round runs through two new subagents, as [Review by subagent](#review-by-subagent) describes, never as a review by the session that fixed |

## Review by subagent

Two subagents run the first review of a plan or an implementation, which the plan orchestrator or the implementation orchestrator starts once its work is committed, and every round after the first in either review. The reviewer has fresh context and the engineer needs no extra session. A subagent cannot ask the engineer anything, so the session that started the subagents presents the choices and makes the fixes.

| Step | Who runs it | What happens |
| --- | --- | --- |
| 1. Review | A new subagent | Reads the matching review orchestrator, `.agents/skills/plan-review-orchestrator/SKILL.md` or `.agents/skills/implementation-review-orchestrator/SKILL.md`, and follows its steps 1 to 5. It applies the skills that orchestrator routes to subagents itself, because a subagent cannot start subagents. It edits nothing and returns the candidate findings |
| 2. Verify | A second new subagent | Runs `finding-verification` on the candidates, as the review orchestrator's step 6 describes, and returns the kept and dropped findings |
| 3. Select | The engineer | Picks from the choices the session presents, as the review orchestrator's step 7 describes |
| 4. Fix | The session | Fixes and commits, as the review orchestrator's fix and commit steps describe |
| 5. Next | The engineer | Accepts or declines the next round, which the session offers as [Offering another round](#offering-another-round) describes |

- **Handoff.** The review subagent gets only the target, the commits and the review orchestrator's path: the plan path and its commit for a plan review, or the base and head commits and the plan path for an implementation review. Pass no summary, decision or reasoning from the session, so the review stays independent.
- **No filtering.** The session presents what verification returns, kept and dropped, and never judges, merges or drops a finding itself.

## How each review fixes

| Review | Fix |
| --- | --- |
| Plan review | Edits the plan with `plan-format` and `writing-style` |
| Implementation review | Fixes each defect under its area's rule skills, with a test, and runs the checks. A reverted deviation or extra changes the code back, and a kept one stays as built |

## Offering another round

After each round's fix commit, ask the engineer whether to run another round, as a question with two choices, Yes and No, when the CLI has one. Put the recommended choice first, mark it `(Recommended)`, and give the one-line reason in its description. On Yes, run the round through two new subagents, as [Review by subagent](#review-by-subagent) describes. On No, finish. Recommend another round when either holds:

- Three or more findings were fixed.
- The fixes changed a lot: a blocker was fixed, a decision, contract, schema or step changed, or the fixes touched several files or sections.

Otherwise recommend stopping, such as when one or two small fixes changed nothing beyond their own lines.

## What stays on disk

Nothing. The fix commit keeps each round's history in Git, and the pull request description is built from those commits.

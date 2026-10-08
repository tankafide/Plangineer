---
name: plan-orchestrator
description: Plans a feature or change in Plangineer and saves the plan in docs/plans/. Use for planning a feature or change. Not for questions, explaining code, or writing or editing product docs, research or other documents.
---

# Plan orchestrator

Takes a request from idea to a plan in `docs/plans/`, ready for plan review. It plans and never writes code. Shared rules: [execution](../orchestrator-references/execution.md), [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the task reaches their area.

| Skill | Applies when |
| --- | --- |
| `.agents/skills/codebase-exploration/SKILL.md` | No exploration context files were provided. Run explore mode in a subagent unless the exploration is trivial |
| `.agents/skills/plan-format/SKILL.md` | Drafting the plan and checking it for blockers |
| `.agents/skills/writing-style/SKILL.md` | Drafting and revising the plan's prose |
| `.agents/skills/architecture-design/SKILL.md` | The plan adds or moves code, adds a package or module, or changes dependencies |
| `.agents/skills/api-contract-design/SKILL.md` | The plan adds or changes a contract, procedure or event |
| `.agents/skills/data-model-design/SKILL.md` | The plan adds or changes a table, constraint, index or migration |
| `.agents/skills/testing/SKILL.md` | Filling the test plan grid, once the "done when" lines are settled |
| `.agents/skills/ui-design-system/SKILL.md` | The plan touches screens or components |
| `.agents/skills/visual-style/SKILL.md` | The plan touches anything visible in `apps/web`: colour, type, icons, spacing, motion or themes |
| `.agents/skills/agent-instructions/SKILL.md` | The plan touches the prompts, orchestrator templates or skill files the product generates, not this repository's own skills |

## Workflow

1. **Branch.** If not already on a work branch, create one as [git workflow](../orchestrator-references/git-workflow.md) describes.
2. **Context.** Read the [stack decisions](../../../docs/engineering/stack-decisions.md). Use the exploration context files if they were provided. Otherwise run `codebase-exploration` in explore mode, in a subagent unless the exploration is trivial.
3. **Scope.** From the request and the findings, bound the behavior and write plain "done when" lines. Use the scope the request gives and do not widen it.
4. **Decide.** Choose the design skills from the routing table and settle each decision as a senior engineer would. Ask the engineer only for business or use-case context, or for a choice between real trade-offs. Ask as a choice, with a recommended option and the cost of each.
5. **Draft.** Write the plan with `plan-format` and `writing-style`. Raise every open point, action item and unknown with the engineer while planning, and resolve it before the plan is saved. The plan never carries one forward. Resolve setup outside the code with the engineer too, as `plan-format` describes under Prerequisites. Check the plan against the blocker checklist. If a blocker remains, resolve it or ask, and repeat. A plan with an open blocker is a draft and is never called ready.
6. **Save.** Write the plan to `docs/plans/YYYY-MM-DD-<slug>.md` and give the engineer the path. Revise the same file for later changes.
7. **Check in.** Before any review, show the engineer a summary of the plan so they can tell at a glance whether it is on target. Write it to `writing-style`, in chat, short enough to read in a minute:
   - **Goal.** What the change does and why, in one or two sentences.
   - **Scope.** The "done when" lines, and what was left out.
   - **Approach.** Each step in one line.
   - **Key decisions.** The decisions that shape the plan, most of all those made without asking the engineer.
   - **Prerequisites.** Anything the engineer set up or must set up outside the code.

   Then ask whether the plan is on target, as a question with two choices when the CLI has one: run the review, or change the plan, with the engineer's feedback as free text. On feedback, revise the plan, check it against the blocker checklist again, and show the updated summary with the same question. Repeat until the engineer confirms. Then commit the plan as [git workflow](../orchestrator-references/git-workflow.md) describes.
8. **Review.** Every plan gets at least one review. Once the engineer has confirmed the plan and it is committed, run plan review through subagents without asking again, as [review loop](../orchestrator-references/review-loop.md#review-by-subagent) describes. Present the verified findings, fix the ones the engineer picks, and commit the round. The plan is ready for implementation only after this step.
9. **Report.** Say what the review changed, offer another round as [review loop](../orchestrator-references/review-loop.md#offering-another-round) describes, and list the skills used, per [execution](../orchestrator-references/execution.md).

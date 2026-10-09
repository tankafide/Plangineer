---
name: implementation-orchestrator
description: Builds and changes code, tests, config, scripts and skills, with or without a plan, and finishes the branch. Use for writing or changing code, fixing bugs, and finishing a branch with its commits and pull request. Not for edits that only touch docs, and not for questions.
---

# Implementation orchestrator

Builds the change and proves it with checks. Shared rules: [execution](../orchestrator-references/execution.md), [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the task reaches their area. `writing-style` is for pull request descriptions. `codebase-exploration` and the design skills matter most when there is no detailed plan.

| Skill | Applies when |
| --- | --- |
{{routing}}

## Workflow

Pick the mode. Start the work in a worktree as [git workflow](../orchestrator-references/git-workflow.md#worktrees) describes.

### With a plan

- Check the plan's Prerequisites first. If any row is not marked `resolved`, build nothing: tell the engineer which items must be resolved, and stop.
- Work in phase order. Settle contracts before any parallel work.
- Consult the design skills as rules when a step touches their area, and test each "done when" line.
- When the work shows the plan needs to change, make the change a senior engineer would make without widening the scope too much, and give the reason in the final report.
- On a point the plan leaves open, make the choice when a senior engineer would see one clear right answer. When it needs business or use-case context, or is a trade-off between real options, stop and ask, or take the recommended option and record it for the final report when the `decisions` [workflow setting](../orchestrator-references/review-loop.md#workflow-settings) is `recommended`. Never guess.

### Without a detailed plan

- Read [project-stack](../project-stack/SKILL.md). With a plan, the plan already carries the stack facts it needs.
- Run `codebase-exploration` in a subagent when the area is unfamiliar or large. Name the work branch as the base when it already has commits.
- Load the design skills the change involves ({{designSkills}}). Settle those decisions as a senior engineer would before writing code, and record each one in the final report.
- A bug fix loads `debugging`.
- Stop and ask when the change needs a decision only the engineer can make, or take the recommended option and record it when `decisions` is `recommended`.

### Checks

Run the `check` command in [project-stack](../project-stack/SKILL.md#commands) before finishing. A change under `.agents/skills/` also runs `npx plangineer-runner skills sync`.

### Review

Every implementation gets at least one review. When the build is done and the checks have run, commit the pass as [git workflow](../orchestrator-references/git-workflow.md) describes. Then, without asking, run implementation review through subagents, as [review loop](../orchestrator-references/review-loop.md#review-by-subagent) describes:

1. A review subagent follows `implementation-review-orchestrator` steps 1 to 5 against the base and head commits and the plan path, and returns candidate findings.
2. A verification subagent runs `finding-verification` on them and returns each kept finding with its recommendation and context.
3. This session presents the verified findings as the [finding format](../orchestrator-references/finding-format.md#presenting-findings) describes, and the engineer picks, unless the `implementationReview` [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) fix them all.
4. This session fixes the picks, runs the checks and commits the round, as `implementation-review-orchestrator` steps 8 to 10 describe.
5. This session runs or offers another round, as the `implementationReview` [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) decide.

Finish the branch once no further round runs.

### Finish

Finish the branch as [git workflow](../orchestrator-references/git-workflow.md) describes: write the pull request description, and push or open the pull request only when the engineer asks.

The final report lists the changes, the decisions made without a plan, every deviation and extra, each review round's outcome, the checks that ran and the checks that did not run, and the skills used, per [execution](../orchestrator-references/execution.md).

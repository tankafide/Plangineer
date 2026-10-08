---
name: implementation-orchestrator
description: Builds and changes code, tests, config, scripts and skills in Plangineer, with or without a plan, and finishes the branch. Use for writing or changing code, fixing bugs, and finishing a branch with its commits and pull request. Not for edits that only touch docs, and not for questions.
---

# Implementation orchestrator

Builds the change and proves it with checks. Shared rules: [execution](../orchestrator-references/execution.md), [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the task reaches their area. `writing-style` is for pull request descriptions. `codebase-exploration` and the design skills matter most when there is no detailed plan.

| Skill | Applies when |
| --- | --- |
| `.agents/skills/codebase-exploration/SKILL.md` | No plan, and the area is unfamiliar or large. Run explore mode in a subagent, with the work branch as the base when it already has commits |
| `.agents/skills/writing-style/SKILL.md` | Writing the pull request description |
| `.agents/skills/architecture-design/SKILL.md` | The change adds or moves code, adds a package or module, or changes dependencies |
| `.agents/skills/api-contract-design/SKILL.md` | The change adds or changes a contract, procedure or event |
| `.agents/skills/data-model-design/SKILL.md` | The change adds or changes a table, constraint, index or migration |
| `.agents/skills/testing/SKILL.md` | Writing tests, once per phase |
| `.agents/skills/ui-design-system/SKILL.md` | The change touches screens or components |
| `.agents/skills/visual-style/SKILL.md` | The change touches anything visible in `apps/web`: colour, type, icons, spacing, motion or themes |
| `.agents/skills/agent-instructions/SKILL.md` | The change touches the prompts, orchestrator templates or skill files the product generates, not this repository's own skills |
| `.agents/skills/debugging/SKILL.md` | The request is a bug fix |
| `.agents/skills/api-server/SKILL.md` | The change is in `apps/api` handlers, middleware or environment parsing |
| `.agents/skills/persistence/SKILL.md` | The change writes queries, transactions or seed data |
| `.agents/skills/frontend-react/SKILL.md` | The change is in `apps/web` components or routes |
| `.agents/skills/frontend-data/SKILL.md` | The change is in `packages/api-client`, query hooks or SSE subscriptions |
| `.agents/skills/auth-and-access/SKILL.md` | The change touches sign-in, roles or runner pairing |
| `.agents/skills/run-orchestration/SKILL.md` | The change touches run dispatch or realtime delivery |
| `.agents/skills/runner-adapters/SKILL.md` | The change is in `apps/runner` or an agent CLI adapter |
| `.agents/skills/github-integration/SKILL.md` | The change touches the GitHub App, webhooks or pull requests |
| `.agents/skills/cross-platform/SKILL.md` | The change touches paths, processes, line endings or the file system |
| `.agents/skills/tooling-and-infra/SKILL.md` | The change touches the workspace, scripts, hooks, CI or check configuration |

## Workflow

Pick the mode. Start the work on a branch as [git workflow](../orchestrator-references/git-workflow.md) describes.

### With a plan

- Check the plan's Prerequisites first. If any row is not marked `resolved`, build nothing: tell the engineer which items must be resolved, and stop.
- Work in phase order. Settle contracts before any parallel work.
- Consult the design skills as rules when a step touches their area, and test each "done when" line.
- When the work shows the plan needs to change, make the change a senior engineer would make without widening the scope too much, and give the reason in the final report.
- On a point the plan leaves open, make the choice when a senior engineer would see one clear right answer. When it needs business or use-case context, or is a trade-off between real options, stop and ask. Never guess.

### Without a detailed plan

- Read the [stack decisions](../../../docs/engineering/stack-decisions.md). With a plan, the plan already carries the stack decisions it needs.
- Run `codebase-exploration` in a subagent when the area is unfamiliar or large. Name the work branch as the base when it already has commits.
- Load the design skills the change involves (`architecture-design`, `api-contract-design`, `data-model-design`, `testing`). Settle those decisions as a senior engineer would before writing code, and record each one in the final report.
- A bug fix loads `debugging`.
- Stop and ask when the change needs a decision only the engineer can make.

### Checks

Run `pnpm verify` before finishing. A change under `.agents/skills/` also runs `pnpm skills:sync` and `pnpm skills:lint`.

`pnpm verify` grows as tooling lands. Compare the checks the `pnpm verify` row in [stack decisions](../../../docs/engineering/stack-decisions.md) names with the steps in `scripts/verify.mjs`, and report each check the script does not run yet as not run. Never report a check that did not run as passed.

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

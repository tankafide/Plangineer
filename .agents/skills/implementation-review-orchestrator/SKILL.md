---
name: implementation-review-orchestrator
description: Reviews a diff, branch, commit or pull request in Plangineer against the plan and the rule skills, verifies the findings, lets the engineer pick which to fix, and fixes them. Use for reviewing code changes. Not for reviewing plans or documents.
---

# Implementation review orchestrator

Reviews a change, has the findings verified, lets the engineer pick which to fix, and fixes them. Shared rules: [execution](../orchestrator-references/execution.md), [finding format](../orchestrator-references/finding-format.md), [review loop](../orchestrator-references/review-loop.md) and [git workflow](../orchestrator-references/git-workflow.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the diff touches their area, except the rows marked Always. Apply each in its implementation review mode, or its review mode when it has only one.

| Skill | Applies when |
| --- | --- |
| `.agents/skills/plan-conformance/SKILL.md` | Always when there is a plan |
| `.agents/skills/finding-verification/SKILL.md` | Always, in a subagent, before the engineer sees any finding |
| `.agents/skills/code-quality/SKILL.md` | Always |
| `.agents/skills/architecture-design/SKILL.md` | The diff adds or moves code, adds a package or module, or changes dependencies, or the recorded decisions cover it |
| `.agents/skills/api-contract-design/SKILL.md` | The diff adds or changes a contract, procedure or event, or the recorded decisions cover it |
| `.agents/skills/data-model-design/SKILL.md` | The diff adds or changes a table, constraint, index or migration, or the recorded decisions cover it |
| `.agents/skills/testing/SKILL.md` | The diff adds or changes tests, or changes behavior |
| `.agents/skills/ui-design-system/SKILL.md` | The diff touches screens or components |
| `.agents/skills/visual-style/SKILL.md` | The diff touches anything visible in `apps/web`: colour, type, icons, spacing, motion or themes |
| `.agents/skills/agent-instructions/SKILL.md` | The diff touches the prompts, orchestrator templates or skill files the product generates, not this repository's own skills |
| `.agents/skills/api-server/SKILL.md` | The diff touches `apps/api` handlers, middleware or environment parsing |
| `.agents/skills/persistence/SKILL.md` | The diff touches queries, transactions or seed data |
| `.agents/skills/frontend-react/SKILL.md` | The diff touches `apps/web` components or routes |
| `.agents/skills/frontend-data/SKILL.md` | The diff touches `packages/api-client`, query hooks or SSE subscriptions |
| `.agents/skills/auth-and-access/SKILL.md` | The diff touches sign-in, roles or runner pairing |
| `.agents/skills/run-orchestration/SKILL.md` | The diff touches run dispatch or realtime delivery |
| `.agents/skills/runner-adapters/SKILL.md` | The diff touches `apps/runner` or an agent CLI adapter |
| `.agents/skills/github-integration/SKILL.md` | The diff touches the GitHub App, webhooks or pull requests |
| `.agents/skills/cross-platform/SKILL.md` | The diff touches paths, processes, line endings or the file system |
| `.agents/skills/tooling-and-infra/SKILL.md` | The diff touches the workspace, scripts, hooks, CI or check configuration |
| `.agents/skills/security/SKILL.md` | The diff touches a trust boundary, secrets or untrusted input |
| `.agents/skills/performance/SKILL.md` | The diff touches queries, lists, realtime delivery or heavy frontend work |
| `.agents/skills/debugging/SKILL.md` | Fixing a selected defect that is a bug |

## Workflow

1. **Target.** Establish the diff, branch, commit or pull request, and find the plan for it in `docs/plans/`. If the target is a plan or a document, stop and say so.
2. **Basis.** With a plan, always run `plan-conformance`, so every step and decision is matched to the diff and every change is matched back to a step. Without a plan, read the [stack decisions](../../../docs/engineering/stack-decisions.md), then check the diff against the stack, the request and the decisions the implementer recorded, and run the design skills in review mode for any area those decisions cover.
3. **Deviations.** Departures from the plan are expected. `plan-conformance` judges each one, and raises only those that do not make sense, widen the scope too much, or are not a call a senior engineer would make.
4. **Concerns.** Pick the implementation skills and concern reviews the diff touches from the routing table, and run them in review mode. Group related skills in one subagent when the review is large, or when a clean-context pass is worth it.
5. **Collect candidates.** Write each candidate finding with the reviewer's fields from the [finding format](../orchestrator-references/finding-format.md). Keep the candidates in the conversation. Nothing is written to `.reviews/`.
6. **Verify.** Hand every candidate to one subagent that reads `finding-verification`, with the base and head commits, the plan path and the paths of the skills the findings cite. Show the engineer only what it returns.
7. **Select.** Show the plan audit from `plan-conformance` first when there is a plan. Then present the findings as the [finding format](../orchestrator-references/finding-format.md#presenting-findings) describes, and ask the engineer which defects to fix and whether to keep or revert each deviation and extra, unless the `implementationReview` [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) fix them all.
8. **Fix.** Fix what the engineer picked, inline and one change at a time.
   - A defect is fixed under the rule skills for its area from the routing table, with a test that shows the fix. A bug follows `debugging`.
   - A deviation or extra the engineer keeps stays as built.
   - A reverted deviation or extra changes the code back to what the plan says.
   - When a fix needs business or use-case context, or a choice between real trade-offs, ask the engineer as a choice with a recommended option.
9. **Checks.** Run the checks as [implementation-orchestrator](../implementation-orchestrator/SKILL.md) describes under Checks, and report each check that did not run as not run.
10. **Commit.** Commit the round's fixes together, as [git workflow](../orchestrator-references/git-workflow.md) describes. The commit body lists the defects fixed, skipped and dropped, each deviation and extra with keep or revert, and the plan audit, so the history stays in Git.
11. **Report.** Say what changed and the checks that ran and did not run, then run or offer another round as the `implementationReview` [workflow settings](../orchestrator-references/review-loop.md#workflow-settings) decide. On another round, run it through subagents, because this session never reviews its own fixes. List the skills used, per [execution](../orchestrator-references/execution.md). Say when no actionable findings were found without implying the review was exhaustive.

---
name: plan-review-orchestrator
description: Reviews a plan in docs/plans/ written in the plan format in one round and returns the findings for the session that wrote the plan to judge and fix. Use for reviewing a plan. Not for reviewing code, diffs or branches, not for reviewing product docs, research or other documents, and not for answering a question about a plan without reviewing it.
---

# Plan review orchestrator

Runs one plan review round as a top-level session and returns the candidate findings. It edits, verifies, fixes and commits nothing. Shared rules: [execution](../orchestrator-references/execution.md), [finding format](../orchestrator-references/finding-format.md) and [review loop](../orchestrator-references/review-loop.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the task reaches their area.

| Skill | Applies when |
| --- | --- |
| `.agents/skills/codebase-exploration/SKILL.md` | Always, in verify mode, in a subagent unless the check is trivial |
| `.agents/skills/plan-format/SKILL.md` | Checking the plan's structure, "done when" lines and blocker checklist |
| `.agents/skills/writing-style/SKILL.md` | Checking the plan's prose. Style breaks are nits |
| `.agents/skills/architecture-design/SKILL.md` | The plan adds or moves code, adds a package or module, or changes dependencies |
| `.agents/skills/api-contract-design/SKILL.md` | The plan adds or changes a contract, procedure or event |
| `.agents/skills/data-model-design/SKILL.md` | The plan adds or changes a table, constraint, index or migration |
| `.agents/skills/testing/SKILL.md` | Checking that the test plan covers every "done when" line |
| `.agents/skills/ui-design-system/SKILL.md` | The plan touches screens or components |
| `.agents/skills/visual-style/SKILL.md` | The plan touches anything visible in `apps/web`: colour, type, icons, spacing, motion or themes |
| `.agents/skills/agent-instructions/SKILL.md` | The plan touches a skill under `.agents/skills/`, or the prompts, orchestrator templates or skill files the product generates |
| `.agents/skills/electron-desktop/SKILL.md` | The plan touches `apps/desktop`, or its packaging, release or update configuration. A step that breaks its rules is a defect |
| `.agents/skills/security/SKILL.md` | The plan adds a trust boundary, such as authentication, a webhook, runner pairing or untrusted input |
| `.agents/skills/performance/SKILL.md` | The plan adds queries, lists, realtime delivery or heavy frontend work |

## Workflow

1. **Target.** Find the plan under `docs/plans/`. If the target is not a plan in the plan format, stop and say so.
2. **Context.** Read the [stack decisions](../../../docs/engineering/stack-decisions.md). Design choices that break the stack are findings. Run `codebase-exploration` in verify mode against the plan and its context files, so the plan's claims are checked against the code and missed areas are found.
3. **Check the plan for:**
   - anything undecided, or left to "decide during implementation"
   - vague steps that an agent could not carry out
   - steps with no "done when" line, and "done when" lines no test covers
   - areas the code touches that the plan does not mention
   - design choices that break the stack decisions or the architecture
4. **Select skills.** From the routing table, pick the design and review skills for the areas the plan touches, and apply each in its plan review mode. Run them as parallel subagents started in one message, grouped by the context they share.
5. **Collect candidates.** Write each candidate finding with the reviewer's fields from the [finding format](../orchestrator-references/finding-format.md). Plan reviews raise defects only.
6. **Return.** When the session's prompt asks for a report, return the findings in it. Otherwise write the findings file as the [finding format](../orchestrator-references/finding-format.md#findings-file) describes, give its path, and tell the engineer to give it to the session that wrote the plan. List the skills used, per [execution](../orchestrator-references/execution.md). Say when no actionable findings were found without implying the review was exhaustive.

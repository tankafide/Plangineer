---
name: implementation-review-orchestrator
description: Reviews a diff, branch, commit or pull request against the plan and the rule skills in one round, and returns the findings and plan audit for the session that wrote the code to judge and fix. Use for reviewing code changes. Not for reviewing plans or documents.
---

# Implementation review orchestrator

Runs one implementation review round as a top-level session and returns the candidate findings and the plan audit. It edits, verifies, fixes and commits nothing. Shared rules: [execution](../orchestrator-references/execution.md), [finding format](../orchestrator-references/finding-format.md) and [review loop](../orchestrator-references/review-loop.md).

## Delegation rule

Work inline by default. Delegate when (a) a task needs a large amount of reading the orchestrator doesn't need to keep, such as any exploration that is not trivial, (b) there are at least two independent investigations or reviews that can run in parallel, or (c) a verification pass should run with clean context. Keep code changes single-threaded. Use parallel writers only after shared contracts are settled and their files don't overlap. Group skills by the context they share, never one subagent per skill and never one per phase. Give each subagent the exact skill paths to read and the decisions it needs, not just a summary. Context skills stay with the orchestrator.

## Routing

Rule skills are read by path with the file-read tool, never through a skill tool, and only when the diff touches their area, except the rows marked Always. Apply each in its implementation review mode, or its review mode when it has only one.

| Skill | Applies when |
| --- | --- |
{{routing}}

## Workflow

1. **Target.** Establish the diff, branch, commit or pull request, and find the plan for it in `docs/plans/`. If the target is a plan or a document, stop and say so.
2. **Basis.** With a plan, always run `plan-conformance`, so every step and decision is matched to the diff and every change is matched back to a step. Without a plan, read [project-stack](../project-stack/SKILL.md), then check the diff against the stack, the request and the decisions the implementer recorded, and run the design skills in review mode for any area those decisions cover.
3. **Deviations.** Departures from the plan are expected. `plan-conformance` judges each one, and raises only those that do not make sense, widen the scope too much, or are not a call a senior engineer would make.
4. **Concerns.** Pick the implementation skills and concern reviews the diff touches from the routing table, and run them in review mode as parallel subagents started in one message, grouped by the context they share.
5. **Collect candidates.** Write each candidate finding with the reviewer's fields from the [finding format](../orchestrator-references/finding-format.md).
6. **Return.** When the session's prompt asks for a report, return the findings and the plan audit from `plan-conformance` in it. Otherwise write the findings file as the [finding format](../orchestrator-references/finding-format.md#findings-file) describes, give its path, and tell the engineer to give it to the session that wrote the code. List the skills used, per [execution](../orchestrator-references/execution.md). Say when no actionable findings were found without implying the review was exhaustive.

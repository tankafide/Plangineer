---
name: finding-verification
description: Verify a reviewer's candidate findings in a clean context before the engineer sees them, keeping only true findings a senior engineer would act on, and recommend what to do with each. Used by plan review and implementation review, always in a subagent.
disable-model-invocation: true
---

# Finding verification

Checks a reviewer's candidate findings with fresh eyes, so the engineer only chooses among findings that hold up. It always runs in a subagent, apart from the reviewer that raised them. It never edits the plan or the code, and it raises no new findings.

## Inputs

The handoff gives:

- For plan review, the plan path and the base commit the review ran against.
- For implementation review, the base and head commits of the diff, and the plan path when there is one.
- The candidate findings, each with the reviewer's fields from the [finding format](../orchestrator-references/finding-format.md): location, claim, kind, severity, suggested change and source skill.
- The path of each rule skill a finding cites.

Read files at the commit under review, with `git show <commit>:<path>`, not the working tree. Get the change itself with `git diff <base> <head>`.

## Method

Judge each finding against the plan and the code, not against the reviewer's reasoning. Try to disprove it first: look for the handling in callers, middleware, schemas, tests and the rest of the plan before accepting that it is missing.

1. **Is it true?** Open the location and check the claim against the plan, the code and the cited rule skill. Drop a claim that is wrong, unsupported or already handled elsewhere. A defect that claims wrong behavior needs a concrete trigger: the input or state that reaches it. When a type check, lint or single test settles the claim, run it instead of reasoning about it.
2. **Does it matter here?** For a defect, ask whether a senior engineer would act on it in this scope. Drop it when it is:
   - In code or plan text the change did not touch, unless the change makes it worse.
   - A preference with no cost, or speculative.
   - Outside the scope of the plan or the change.
   - Against a deliberate decision, or an explicitly silenced check with a stated reason, that breaks no rule.

   For a deviation or extra, check the reviewer's judgment with the tests in [plan-conformance](../plan-conformance/SKILL.md): drop it when the departure serves the step's intent, does not widen the scope too much, breaks no decision or rule, and is a call a senior engineer would make.
3. **Is the severity right?** Use the definitions in the [finding format](../orchestrator-references/finding-format.md). Raise or lower it when it is wrong, and say why.
4. **Is the suggested change right?** When the problem is real but the suggested change is wrong, too broad or breaks another rule, replace it and say so.
5. **Duplicates.** Merge findings that share a cause into the first of them, keeping the clearest location and suggested change.
6. **Recommend.** Give each finding kept a recommendation with a one-line reason.
   - **Defect:** `address` for every `blocker`, and for a `should fix` whose fix is clear and in scope. `skip` for a `nit`, and for a real problem whose fix costs more than it saves here.
   - **Deviation or extra:** `revert` when it breaks a decision, a rule or a "done when" line, or widens the scope too much. `keep` when the problem is minor and undoing it costs more than it saves.

When you cannot verify a claim, drop it and say what you could not check. Do not keep a finding on the reviewer's word.

## What you return

One row per candidate finding, in the order received. A finding merged into another is `drop` with the reason "merged into row N".

| Field | Contents |
| --- | --- |
| Finding | The reviewer's claim, or the merged claim |
| Verdict | `keep` or `drop` |
| Severity | The final severity, marked when you changed it |
| Suggested change | The final suggested change, marked when you changed it |
| Recommendation | `address` or `skip` for a defect, `keep` or `revert` for a deviation or extra |
| Reason | One line: why it was dropped, why the severity changed, or why you recommend it |

For each kept finding, also return what the orchestrator needs to [present it](../orchestrator-references/finding-format.md#presenting-findings):

| Field | Contents |
| --- | --- |
| Title | The finding in a few plain words |
| What it says now | What the plan or code does at the location |
| If not fixed | The concrete consequence: what fails, when, and who notices |
| Evidence | What you checked or ran to confirm the claim |
| Fix cost | How big the suggested change is |
| Group | What it shares with other kept findings, such as "breaks the build" |

Then list the files and skills you read, and the commands you ran.

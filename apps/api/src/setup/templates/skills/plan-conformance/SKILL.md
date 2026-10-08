---
name: plan-conformance
description: Match every plan step, decision, constraint and "done when" line to the diff and every change back to a step, raise deviations and extras, and return a plan audit with one row per step. Used by implementation review.
disable-model-invocation: true
---

# Plan conformance

Checks that the diff is what the approved plan describes, no more and no less. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `plan-conformance`. It never edits code or the plan.

Quality, security and performance belong to other skills. Raise a defect here only when it is a plan departure.

## Inputs

- **Plan.** The plan file as it stands on the branch. A plan revised during implementation is the basis in its revised form.
- **Diff.** From the base commit the plan records under Decisions to the branch head. Without a recorded base, use the merge base with `{{defaultBranch}}` and say so in the audit.
- **Evidence is the code.** The implementer's report, commit messages and PR description are claims, not evidence. Confirm every claim, including "done" and "kept simple on purpose", in the diff.

## Method

1. **Read the plan whole.** List every step, "done when" line, decision, constraint and Test plan row, numbered as the plan numbers them. Include what Decisions says was left out.
2. **Read the diff whole.** List every changed file and group the changes by purpose.
3. **Forward match.** For each step, find the hunks that build it. Check each bullet, each named file and each decision it relies on. A named queue, library, table, route, command, flag or limit must be the one in the code.
4. **Done-when match.** For each "done when" line, find the code that makes it true and a test that asserts it. A test that exists but would pass with the line false, or is skipped with `.skip` or `.todo`, does not count. A line with no code or no asserting test is not met.
5. **Test plan and constraints.** Each ticked cell in the Test plan grid has a test at that layer in the diff, and each constraint has the check that proves its target. Agent and human checks are not in the diff; list them as not checked, never as met.
6. **Backward match.** For each changed file and hunk, name the step that asked for it. A change no step asked for is an extra. Building something Decisions says was left out breaks a decision.
7. **Judge each departure.** Implementation can show that the plan needs to change, so a departure is not wrong in itself. It is sound when all of these hold:
   - it serves the intent of the step it departs from
   - it does not widen the scope too much. A small addition the work needed is fine. A new feature, table, contract, dependency or command the plan never called for is too much
   - it breaks no plan decision, "done when" line, constraint, stack decision or rule skill
   - a senior engineer would have made the same call
8. **Raise only what is not sound.** A sound departure goes in the plan audit with its reason and raises no finding. A departure that fails any test above is a finding. A step not built, or a "done when" line or constraint not met, is always a finding.

## What counts

| Finding | Kind | Example |
| --- | --- | --- |
| Code does something other than the step or decision says | `deviation` | The plan names `FOR UPDATE SKIP LOCKED` and the code polls on a timer |
| A step, bullet, "done when" line, ticked test or constraint has nothing behind it | `deviation` | A step lists a `--check` flag and the script has none |
| A step is built in a different file or package than named | `deviation` | The plan puts a schema in the shared contracts module and the code puts it in a server module |
| A change no step asked for | `extra` | A new option, a refactor of a neighbouring module, an added dependency, file or script |

Not departures: tests for a step's behavior, and edits the step needs to compile, such as an import or a type. Generated files and the lockfile follow the step that caused them. Say so in the audit rather than raising an extra.

Every deviation or extra finding names the plan step it relates to (for an extra, the nearest one) and which test in step 7 it fails. Severity is `blocker` when a decision, constraint or "done when" line is broken or a step is missing, `should fix` otherwise.

## Plan audit

Return the plan audit as the last section of the findings. It has one row for every step, in plan order, with no step omitted or merged.

| Step | Status | Evidence | Finding |
| --- | --- | --- | --- |
| 1. Step title | built as planned | Files and lines that build it, and the test that asserts each "done when" line | none |
| 2. Step title | deviated | Files and lines, and what differs | Location of the finding |
| 3. Step title | not built | What is missing | Location of the finding |

Status is exactly one of `built as planned`, `deviated` or `not built`.

- **Built as planned.** Every bullet, file, decision and "done when" line of the step holds, and the step has no finding.
- **Deviated.** The step is built, but a bullet, decision or "done when" line differs or is missing. A partial build is `deviated`. The evidence says what exists, what is missing, and whether the departure is sound, with the reason. One failing "done when" line makes the step `deviated`.
- **Not built.** No part of the step is in the diff.
- A step whose work is already in the base commit is `built as planned`, with the existing file named in the evidence.

Extras follow in a second table.

| Extra | Files and lines | Nearest step | Sound | Finding |
| --- | --- | --- | --- | --- |
| What was added | Locations | Step number | `yes` with the reason, or `no` | Location of the finding, or `none` when sound |

Write `none` under the table when there are no extras. Then list constraints and agent or human checks not proven by the diff, one line each. The engineer keeps or reverts each raised row, so leave that decision to them.

## Without a plan

Use the request and the implementer's recorded decisions as the basis, and return no plan audit. Raise an extra for any change the request did not ask for, and a deviation for any recorded decision the code does not follow.

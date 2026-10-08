---
name: plan-format
description: The plan template and blocker checklist. Use when drafting a plan, and when checking a plan's structure, "done when" lines, test plan grid and readiness before review.
disable-model-invocation: true
---

# Plan format

The structure every plan follows. `writing-style` fixes the prose.

## File

`docs/plans/YYYY-MM-DD-<slug>.md`. The date is the day the plan is first written and the slug is short kebab-case. Revise the same file for later changes. The title is the first line and the date the second.

## Template

````markdown
# <Plan title>

<Mon D, YYYY>

## Goal

One or two lines on what the change is for, and what it leaves out.

## Prerequisites

(Only when the work needs setup outside the code.)

| Item | Who | Status |
| --- | --- | --- |
| A GitHub App token in `.env` as `GITHUB_TOKEN` | Engineer | open |

## Steps

### 1. <Step name>

**Files:** `path/one.ts`, `path/two.ts`

What the step does, in short bullets or one paragraph. Tables for anything compared across rows.

**Done when:**

- 1a. One plain sentence a test or a check can prove.
- 1b. ...

### 2. ...

## Decisions

What was decided, by whom and why, including what was deliberately left out.

## Constraints

(Only when flagged.) Each limit with a target and the check that proves it.

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. <the line, shortened> | ✓ | | | | | |

One paragraph on what each layer covers and the fixtures it uses.

## Verification

**Automated**

- Commands that must pass, such as the `check` command in `project-stack`.

**Agent checks**

- Checks an agent runs through the API, Playwright or the CLI.

**Human checks**

- Checks only a person can make.
````

## Rules for each section

- **Goal.** One or two lines. No background essay.
- **Prerequisites.** Setup outside the code that does not exist yet and must be done before implementation, such as an account, token, registered app or service access. Avoid them: resolve each with the engineer while planning, and list one only when the engineer agrees. Each row has an owner and a status, `open` or `resolved`, which the engineer updates. Omit the section when empty.
- **Steps.** In build order. Each step names its files and has at least one "done when" line. Size a step so it can be verified and reviewed on its own: split one a reviewer could half accept. Give signatures, schema fields, error codes and exact values. Add code only where those still leave two readings. A feature across repositories groups steps by repository, then by phase. Steps in one phase run in parallel only if their files do not overlap.
- **Done when.** Numbered `<step><letter>`, such as `1a`. One plain sentence each, written as an observable result and not an activity. "The API rejects a plan with no steps" is a line. "Validation is added" is not.
- **Decisions.** One bullet per decision with its reason. Record every decision made without asking the engineer, so they can overrule it, and record what was left out.
- **Constraints.** Add the section only when exploration shows a risk flag, the request uses words like bulk, import, search or real time, or a standing rule applies. Each constraint has a target and its own Test plan row. Omit the heading otherwise.
- **Test plan.** One row per "done when" line and per constraint, numbered the same way. `testing` fills the ticks.
- **Verification.** Split into automated, agent checks and human checks. Name the exact commands. Keep human checks to what nothing else can judge, as `testing` describes.
- **Inputs.** When the plan was built from context files, list their paths under Decisions. When it edits existing code, record the base commit there too, one per repository.

## Plan mode

Draft each section from the settled decisions, in the order above. Write the Test plan after the "done when" lines are final. Run the blocker checklist and fix every item before telling the engineer the plan is ready. A plan with an open blocker is a draft and is never called ready.

## Plan review mode

Check the plan against the template and the checklist. Raise one finding per problem in the [finding format](../orchestrator-references/finding-format.md), with `plan-format` as the source skill. Plan reviews raise defects only.

| Problem | Severity |
| --- | --- |
| A blocker checklist item fails | `blocker` |
| A required section is missing or out of order | `should fix` |
| "Done when" lines are not numbered like `1a`, or the file name breaks the pattern | `nit` |

## Blocker checklist

A plan is ready only when every item passes.

1. No open question, "TBD", "decide during implementation" or "to be confirmed" anywhere.
2. Every requirement in the request maps to a step, or is left out under Decisions.
3. Every step names its files, and each path is concrete.
4. Every step has at least one "done when" line, and each is one plain sentence that can be proven.
5. No step is vague enough that an agent could build it two different ways. Names, shapes and values are given.
6. A name, type, path or value used in more than one step is spelled the same in each.
7. Every "done when" line has a Test plan row with at least one tick. A row with nothing ticked is a gap.
8. Every constraint has a target, a check and its own Test plan row.
9. Every decision that crosses steps or repositories is recorded once under Decisions, and each step that depends on it points to it.
10. Every dependency, library or service the plan relies on is named, and either exists in the stack or is added by a step.
11. The step order is possible: nothing uses a contract, table or file that a later step creates.
12. Outside setup is resolved, or listed under Prerequisites with the engineer's agreement. No action item is left anywhere else. Open prerequisites block implementation, not the plan.
13. Every behavior of a library, CLI or API the plan relies on has been checked. One that cannot be checked while planning is proven by the first step that needs it, before anything builds on it.
14. Verification names the commands, and every check that is not automated says who runs it.
15. The plan follows the stack decisions and the architecture rules, or records why not under Decisions.

Prose style is not on this list. `writing-style` raises its breaks as nits.

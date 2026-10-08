---
name: architecture-design
description: Where code belongs in the repository, the import rules, dependency direction, module depth and the rules for pure business logic. Use when planning, implementing or reviewing code placement, a new module or package, or changed dependencies.
disable-model-invocation: true
---

# Architecture design

Where code belongs and what may import what. Dependencies point inward, with no cross-layer shortcuts.

## Imports

The layout table in [project-stack](../project-stack/SKILL.md#layout) is the allow list: a module imports only what its row names. This skill does not restate it.

<!-- slot: fact import-rules: one line per import rule the repository enforces or follows: shared-code direction, entry points, layers inside an app, and the tool and command that check them -->

- A needed import that breaks a rule means the code is in the wrong place. Move the code. If the rule itself is wrong, change it in `project-stack` deliberately and record why. Never work around it.

## Where new code goes

<!-- slot: fact layout-and-placement: a table of the code (boundary shape, business decision, data access, handler, UI, client hook, other helper) and the path it goes in; route other helpers to the placement ladder -->

## Known cases

One test decides every new package, interface, adapter, registry, strategy, shared hook or shared component: its second case exists or is known. Known means in the code, named in the plan or the request, or listed as coming work in the project's docs. An imagined case does not count.

- When a second case is known, shape the first so the second slots in, and record the case under Decisions.
- When a shape repeats, extracting it is part of the change if it is small. If not, raise it with the engineer.
- Use a pattern the repository already has, and keep one pattern per problem.

## Reuse and placement

- Before writing a function, type, schema or component, search the workspace for one that does the job, by name and by behavior, and check the standard library and existing dependencies. Extend what nearly fits and check every caller still holds. Never write a second copy.
- Follow the structure of the closest existing feature.
- Change behavior where it is defined, not at each caller. A change to shared code accounts for every caller and its tests.

### Placement ladder

Code lives at the lowest level all its callers share, and moves up one rung when a new caller needs it.

1. **One caller.** Beside it, in the same file or feature folder.
2. **Two areas in one module.** The module's shared folder, in a file named for its topic.
3. **Two apps.** Down into a shared package: boundary shapes and business decisions where the placement table puts them, anything else to a new package under the known-cases test. Delete the copies.

Example: `formatDuration` written in the runs feature and copied into the plans feature is wrong. Move it to one shared file named for durations, point both features at it and delete the copy.

Group code by feature or area, not by kind (`services/`, `helpers/`). Name each file for its one topic. No grab-bag files such as `utils` or `common`.

### Module depth

A module earns its place when deleting it would spread its complexity across its callers. Do not add:

- A pass-through function or layer that only forwards a call.
- A wrapper that only renames.
- A near-duplicate of an existing type.

Mapping at an I/O boundary, from a row or a vendor shape to a boundary type, is real work and stays.

## Pure core rules

The pure core is the code the placement table names for business decisions.

- Pure functions: no I/O, clock, randomness, environment or logging. Pass time and ids in as arguments.
- Never throw for an expected outcome. Return a typed result. Throw only for a broken invariant.

<!-- slot: rule pure-core: one line per rule for writing the pure core in this stack: result types, boundary types, exhaustive matching, file naming and where its tests sit -->

## Plan mode

1. Place each piece of new or changed code with the table, the ladder and the rules above, and name each new import between packages.
2. Put business decisions in the pure core and side effects at the edges.
3. Name the existing code each step reuses or extends, from the exploration's reusable code list.
4. Shape new structure for the known cases, as Known cases describes.
5. Record each placement decision, pattern and new package under Decisions, with the case that justifies it and the option rejected.

## Implement mode

Place each file where the plan or the table says. Apply reuse and the ladder before writing new code, and check each new import against the rules. When two apps need code, move it into a package first. Run the `check` command from [project-stack](../project-stack/SKILL.md#commands).

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `architecture-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A step places code where the layout forbids, or needs an import that breaks it | `blocker` |
| I/O, clock or randomness planned in the pure core | `blocker` |
| A step works around a layout rule instead of changing `project-stack` under Decisions | `should fix` |
| A step names no package or path for new code | `should fix` |
| A new package or abstraction with no known second case | `should fix` |
| A step writes new code where existing code does the job, or names no reuse that exploration found | `should fix` |
| A design that will need rework for a known upcoming case | `should fix` |
| A boundary shape or a business decision planned outside the place the placement table names | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `architecture-design` as the source skill. Do not raise what the `check` command in [project-stack](../project-stack/SKILL.md#commands) reports. Spend review on what it cannot see.

| Check | Severity |
| --- | --- |
| An import breaks the layout table, or reaches inside another package past its entry point | `blocker` |
| I/O, clock, randomness or a framework import in the pure core | `blocker` |
| A boundary shape defined outside the place the placement table names | `should fix` |
| A new package or abstraction with no known second case | `should fix` |
| New code that duplicates an existing function, type, schema, component or dependency, or the same code copied into two places | `should fix` |
| Code above or below the rung its callers need, code grouped by kind, a grab-bag file, or a re-export file outside a package entry | `should fix` |
| A pass-through, a renaming wrapper or a near-duplicate type | `should fix` |
| A fix patched into several callers instead of the code they share | `should fix` |
| A second pattern for a problem the repository already solves | `should fix` |
| A business decision outside the pure core, or a pure-core function that throws for an expected outcome | `should fix` |

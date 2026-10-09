---
name: architecture-design
description: Where code belongs among the packages and apps, the import rules, dependency direction, module depth and the packages/domain rules. Use when planning, implementing or reviewing code placement, a new module or package, or changed dependencies.
disable-model-invocation: true
---

# Architecture design

Where code belongs and what may import what. Dependencies point inward, with no cross-layer shortcuts.

## Imports

The [package layout](../../../docs/engineering/stack-decisions.md#package-layout) table is the allow list: a package imports only what its row names. This skill does not restate it.

- Code two apps need moves down into a package. Packages never import apps.
- A package exposes one entry point, `src/index.ts`, through `exports` in its `package.json`. Other packages import only that entry, never a path inside its `src/`. No other `index.ts` re-export files.
- Layers inside an app belong to its area skill: router, service and repository in `api-server`; routes, features and components in `frontend-react`; adapters in `runner-adapters`.
- dependency-cruiser enforces the table, no cycles and no deep imports in `pnpm verify`, in the form `tooling-and-infra` sets. A layout change updates its config in the same change.
- A needed import that breaks a rule means the code is in the wrong place. Move the code. If the rule itself is wrong, change `stack-decisions.md` deliberately and record why. Never work around it.

## Where new code goes

| The code | Goes in |
| --- | --- |
| A shape that crosses a process boundary (HTTP, WebSocket, database JSONB) | `packages/contracts` |
| A business decision, such as triage or staleness, however many callers it has | `packages/domain` |
| A query, transaction or Drizzle table, a handler, middleware or webhook | `apps/api` |
| A query hook or SSE subscription | `packages/api-client` |
| A component, route or form | `apps/web` |
| A CLI adapter, worktree or process handling | `apps/runner` |
| Window, tray, login item, update, or starting and stopping the local stack | `apps/desktop`, which imports only `contracts` |
| Any other helper, such as formatting a duration | The placement ladder below |

## Known cases

One test decides every new package, interface, adapter, registry, strategy, shared hook or shared component: its second case exists or is known. Known means in the code, named in the plan or the request, or listed as coming work in the project's docs. An imagined case does not count.

- When a second case is known, shape the first so the second slots in, and record the case under Decisions. `runner-adapters` is the model: one interface per CLI, because Codex follows Claude Code.
- When a shape repeats, extracting it is part of the change if it is small. If not, raise it with the engineer.
- Use a pattern the repository already has, and keep one pattern per problem.

## Reuse and placement

- Before writing a function, type, schema or component, search the workspace for one that does the job, by name and by behavior, and check the standard library and existing dependencies. Extend what nearly fits and check every caller still holds. Never write a second copy.
- Follow the structure of the closest existing feature.
- Change behavior where it is defined, not at each caller. A change to shared code accounts for every caller and its tests.

### Placement ladder

Code lives at the lowest level all its callers share, and moves up one rung when a new caller needs it.

1. **One caller.** Beside it, in the same file or feature folder.
2. **Two areas in one package.** The package's `src/lib/`, in a file named for its topic.
3. **Two apps.** Down into a package: shapes to `contracts`, business decisions to `domain`, anything else to a new package under the known-cases test. Delete the copies.

Example: `formatDuration` written in `src/features/runs/` and copied into `src/features/plans/` is wrong. Move it to `src/lib/durations.ts`, point both features at it and delete the copy.

Group code by feature or area (`src/<area>/`), not by kind (`services/`, `helpers/`). Name each file for its one topic. No grab-bag files such as `utils.ts` or `common.ts`.

### Module depth

A module earns its place when deleting it would spread its complexity across its callers. Do not add:

- A pass-through function or layer that only forwards a call.
- A wrapper that only renames.
- A near-duplicate of an existing type.

Mapping at an I/O boundary, from a row or a vendor shape to a `contracts` type, is real work and stays.

## `packages/domain` rules

- Pure functions: no I/O, clock, randomness, environment or logging. Pass time and ids in as arguments.
- A shape that crosses a boundary uses the `contracts` type. A decision's own inputs and results are typed beside the decision.
- Never throw for an expected outcome. Return a typed result such as `{ ok: false, reason }`. Throw only for a broken invariant.
- One file per decision, named for it (`triage.ts`, `staleness.ts`), with its test beside it. Test depth is in `testing`.
- Switches over a discriminated union are exhaustive, with a `never` check.

## Plan mode

1. Place each piece of new or changed code with the table, the ladder and the rules above, and name each new import between packages.
2. Put business decisions in `domain` and side effects at the edges in `apps/*`.
3. Name the existing code each step reuses or extends, from the exploration's reusable code list.
4. Shape new structure for the known cases, as Known cases describes.
5. Record each placement decision, pattern and new package under Decisions, with the case that justifies it and the option rejected.

## Implement mode

Place each file where the plan or the table says. Apply reuse and the ladder before writing new code, and check each new import against the rules. When two apps need code, move it into a package first. Run `pnpm verify`.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `architecture-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A step places code where the layout forbids, or needs an import that breaks it | `blocker` |
| I/O, clock or randomness planned in `packages/domain` | `blocker` |
| A step works around a layout rule instead of changing `stack-decisions.md` under Decisions | `should fix` |
| A step names no package or path for new code | `should fix` |
| A new package or abstraction with no known second case | `should fix` |
| A step writes new code where existing code does the job, or names no reuse that exploration found | `should fix` |
| A design that will need rework for a known upcoming case | `should fix` |
| A boundary shape planned outside `contracts`, or a business decision planned in an app | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `architecture-design` as the source skill. Do not raise what dependency-cruiser or Knip report in `pnpm verify`. Spend review on what they cannot see.

| Check | Severity |
| --- | --- |
| An import breaks the layout table, or reaches inside another package's `src/` | `blocker` |
| I/O, clock, randomness or a framework import in `packages/domain` | `blocker` |
| A boundary shape defined outside `contracts` | `should fix` |
| A new package or abstraction with no known second case | `should fix` |
| New code that duplicates an existing function, type, schema, component or dependency, or the same code copied into two places | `should fix` |
| Code above or below the rung its callers need, code grouped by kind, a grab-bag file, or an `index.ts` re-export file outside a package entry | `should fix` |
| A pass-through, a renaming wrapper or a near-duplicate type | `should fix` |
| A fix patched into several callers instead of the code they share | `should fix` |
| A second pattern for a problem the repository already solves | `should fix` |
| A business decision in an app instead of `domain`, or a domain function that throws for an expected outcome | `should fix` |

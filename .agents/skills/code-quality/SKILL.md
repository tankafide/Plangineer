---
name: code-quality
description: Review a diff for correctness, error handling, naming, small single-purpose units, strict types, dead or commented code, speculative abstraction, fallbacks and style, using the AGENTS.md standards as checks. Used by implementation review.
disable-model-invocation: true
---

# Code quality

Reviews the diff's own quality. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `code-quality`, as `defect` only. Departures from the plan belong to `plan-conformance`, and area rules belong to the implementation skills. Read `AGENTS.md` first, then each changed file in full and the callers of each changed function, because most checks compare the diff to them.

Review what the diff adds or changes, and what it breaks in callers and tests. Do not raise old problems in untouched code. Oxlint (type-aware), the typecheck and Knip run in `pnpm verify`. Do not raise what they catch. Raise what they allow.

## Correctness

- Trace each changed path with real inputs: empty, one, many, missing, malformed, duplicate and concurrent. Check boundaries and off-by-one limits.
- A check-then-act on shared state (read, decide, write) without a transaction, lock or conditional write is a race.
- A function mutates its arguments or module-level state that callers do not expect.
- Every promise is awaited or deliberately returned, including inside callbacks: `forEach(async ...)` and an `async` event handler drop their rejections. Every resource is released on every path, including the error path: streams, child processes, timers, listeners and connections.
- A fix addresses the cause. A symptom fix is a defect: a catch that hides an error, a special case for one input, or a retry around a bug.

## Errors

- A `catch` handles a specific, expected error and rethrows the rest. A catch that logs and continues, returns a value or narrows nothing is a fallback.
- A rethrown or wrapped error keeps the original as `cause`. Only `Error` instances are thrown.
- An error message names the operation and the failing value, such as the id or path, so a log line alone locates it.
- An expected outcome is a typed result, not an exception. A broken invariant throws.

## AGENTS.md standards as checks

| Standard | Raise a finding when |
| --- | --- |
| Small, single-purpose units | A function does more than one thing, mixes levels of detail, or needs a comment to say what a block does. A boolean parameter switches it between two jobs. Nesting deeper than an early return would need |
| No dead code | Code is unreachable, a parameter or branch is never used, or a changed path leaves old code behind |
| No commented-out code | Any size |
| Clean architecture | Logic sits in the wrong layer or imports across one. Rules belong to `architecture-design` |
| Consistent style | The diff adds a second way to do something the repository already does: error handling, naming, file layout, logging or test structure |
| Cross-platform | A path, process, separator or line ending is handled in a platform-specific way. Rules belong to `cross-platform` |
| No fallbacks | A default hides a failure: `?? []` or `?? ''` over a missing result, an optional chain that turns a required value into `undefined`, a catch that returns a value, a retry that ends without surfacing the error, an environment variable with a default, or a silent skip. The only exception is a recognized design practice that calls for one, such as a bounded retry with backoff for a transient failure that fails loudly when it gives up |
| No compatibility | A shim, alias, deprecated path, flag, version field or migration of an old shape |
| No speculative abstraction | An abstraction or helper that fails the known-cases test in `architecture-design`, a config option nothing sets, or a parameter for a future case |
| Build only what is asked | Options or cases the task did not need |
| Tests for new behavior | A new behavior, branch or error path has no test, or its test would pass without the change. Test depth belongs to `testing` |

## Types

- No `any`, no `as` cast that asserts what the compiler cannot see, no non-null `!`, and no `@ts-ignore`. A `@ts-expect-error` needs a comment naming why it cannot be fixed. Use `satisfies` to check a literal against a type.
- `JSON.parse`, `response.json()`, a `catch` binding and any other untrusted value is `unknown` until a Zod schema parses it. Boundary schemas live in `packages/contracts`, and their types come from `z.infer`. A hand-written type that duplicates a schema is a defect.
- A switch over a union ends in a `never` check. Types model the states: a discriminated union instead of optional fields that are required in one state, and a union or branded id instead of a plain string.
- A literal number or string with meaning, such as a timeout or a status, is a named constant or a union member.

## Names and comments

- Names use the plan's domain terms. No `data`, `info`, `util`, `helper`, `manager`, `handle` or numbered names. A boolean reads as a question: `isStale`, `hasLease`. Files are kebab-case.
- A comment explains why, never what. A TODO is a defect unless the plan asks for it.

## Severity

| Severity | Examples |
| --- | --- |
| `blocker` | Wrong result, data loss, a race, an unhandled or swallowed failure, a leaked process or connection, or a fallback that hides a failed run |
| `should fix` | Dead code, speculative abstraction, a weak type, a cast, a second pattern, a function doing two jobs, an error without `cause` or context, a missing test |
| `nit` | Naming and comment polish the linter allows |

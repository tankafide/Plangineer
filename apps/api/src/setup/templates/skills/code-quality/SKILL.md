---
name: code-quality
description: Review a diff for correctness, error handling, naming, small single-purpose units, strict types, dead or commented code, speculative abstraction and style, using the repository's standards as checks. Used by implementation review.
disable-model-invocation: true
---

# Code quality

Reviews the diff's own quality. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `code-quality`, as `defect` only. Departures from the plan belong to `plan-conformance`, and area rules belong to the implementation skills. Read the conventions in [project-stack](../project-stack/SKILL.md#conventions) first, then each changed file in full and the callers of each changed function, because most checks compare the diff to them.

Review what the diff adds or changes, and what it breaks in callers and tests. Do not raise old problems in untouched code. Do not raise what the static checks catch. Raise what they allow.

<!-- slot: fact static-checks: one line per static check the check command runs (linter, typecheck, dead-code or dependency tool) and what kind of problem it catches -->

## Correctness

- Trace each changed path with real inputs: empty, one, many, missing, malformed, duplicate and concurrent. Check boundaries and off-by-one limits.
- A check-then-act on shared state (read, decide, write) without a transaction, lock or conditional write is a race.
- A function mutates its arguments or module-level state that callers do not expect.
- Every async operation is awaited or deliberately returned, including inside callbacks and event handlers that drop their failures. Every resource is released on every path, including the error path: streams, child processes, timers, listeners and connections.
- A fix addresses the cause. A symptom fix is a defect: a catch that hides an error, a special case for one input, or a retry around a bug.

## Errors

- A catch handles a specific, expected error and rethrows the rest. A catch that logs and continues, returns a value or narrows nothing hides the error.
- A rethrown or wrapped error keeps the original error as its cause.
- An error message names the operation and the failing value, such as the id or path, so a log line alone locates it.
- An expected outcome is a typed result, not an exception. A broken invariant throws.

## Standards as checks

| Standard | Raise a finding when |
| --- | --- |
| Small, single-purpose units | A function does more than one thing, mixes levels of detail, or needs a comment to say what a block does. A boolean parameter switches it between two jobs. Nesting deeper than an early return would need |
| No dead code | Code is unreachable, a parameter or branch is never used, or a changed path leaves old code behind |
| No commented-out code | Any size |
| Clean architecture | Logic sits in the wrong layer or imports across one. Rules belong to `architecture-design` |
| Consistent style | The diff adds a second way to do something the repository already does: error handling, naming, file layout, logging or test structure |
| No speculative abstraction | An abstraction or helper that fails the known-cases test in `architecture-design`, a config option nothing sets, or a parameter for a future case |
| Build only what is asked | Options or cases the task did not need |
| Tests for new behavior | A new behavior, branch or error path has no test, or its test would pass without the change. Test depth belongs to `testing` |

The repository's own standards:

<!-- slot: fact standards: a table (Standard, Raise a finding when) of each written standard in the repository's agent instructions or contributing docs that the table above does not cover -->

## Types

- An untrusted value, such as parsed JSON, a response body or a caught error, stays unchecked until a schema parses it. A hand-written type that duplicates a schema is a defect.
- A switch over a union handles every case, and the compiler or linter proves it. Types model the states: a discriminated union instead of optional fields that are required in one state, and a union or distinct id type instead of a plain string.
- A literal number or string with meaning, such as a timeout or a status, is a named constant or a union member.

<!-- slot: rule language-rules: one line per type and language rule for this stack's languages: unsafe escapes to ban, how to check untrusted values, where boundary schemas live, and exhaustiveness checks -->

## Names and comments

- Names use the plan's domain terms. No `data`, `info`, `util`, `helper`, `manager`, `handle` or numbered names. A boolean reads as a question: `isStale`, `hasLease`.
- A comment explains why, never what. A TODO is a defect unless the plan asks for it.

## Severity

| Severity | Examples |
| --- | --- |
| `blocker` | Wrong result, data loss, a race, an unhandled or swallowed failure, or a leaked process or connection |
| `should fix` | Dead code, speculative abstraction, a weak type, an unchecked cast, a second pattern, a function doing two jobs, an error without its cause or context, a missing test |
| `nit` | Naming and comment polish the linter allows |

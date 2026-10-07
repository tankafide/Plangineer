---
name: api-contract-design
description: Design oRPC procedures and Zod 4 schemas in packages/contracts, including errors, pagination, RunEvent and the runner protocol. Use when planning, implementing or reviewing a contract, procedure or event.
disable-model-invocation: true
---

# API contract design

Every shape that crosses a process boundary is a Zod 4 schema in `packages/contracts`, and every procedure is an oRPC 1.x contract built from those schemas. The server and the clients read the same contract. Handlers belong to `api-server` and clients to `frontend-data`.

## Rules

- **One source.** `contracts` depends on `zod` and `@orpc/contract` only. Define each shape once and derive types with `z.output`, or `z.input` for a caller's view of a field with a default. Never hand-write a second type for a shape.
- **One router.** The contract router is one nested object, such as `{ plan: { get, list } }`, which `api-server` implements with `implement(contract)`. Procedures are `<resource>.<verb>` in camelCase. Schemas are `PascalCase` with a suffix: `PlanGetInput`, `PlanGetOutput`.
- **Input and output on every procedure.** A procedure without `.output()` types its result as `unknown` on the client. Omit `.input()` when a procedure takes nothing.
- **Strict inputs.** Inputs use `z.strictObject`, so unknown keys fail. Ids are `z.uuid()`, every string and array has `.min` and `.max`, and closed sets are `z.enum` or `z.discriminatedUnion` on `type` or `kind`, never free strings, `any` or `unknown` unless the value is truly opaque.
- **Outputs expose no internals.** Outputs use `z.object`, which strips unknown keys, so an extra column never reaches the client. Never use `z.looseObject` in an output. Never return hashed tokens, secrets or raw database rows.
- **JSON-safe, no transforms.** The same schemas parse JSONB rows and WebSocket messages, so no `.transform`, `z.coerce`, `z.date()`, `bigint`, `Map` or `Set`. Dates are ISO 8601 UTC strings from `z.iso.datetime()`, which rejects offsets.
- **Defaults.** A schema default exists only when the absent value has one meaning in the product.

## Errors

- Every procedure starts from one base builder, `oc.errors({...})`, holding the shared codes `UNAUTHORIZED`, `FORBIDDEN` and `INPUT_VALIDATION_FAILED`. Add `NOT_FOUND`, `CONFLICT` and any code the plan names with `.errors()` on the procedure that can raise it.
- Each entry has a `data` schema when the client needs detail. Data that fails it reaches the client as an unknown error, not the typed one.
- A custom code sets `status`, or oRPC sends 500.
- `INPUT_VALIDATION_FAILED` has status 422 and data `{ formErrors: string[], fieldErrors: Record<string, string[]> }`, the shape of `z.flattenError`. `api-server` maps oRPC's `BAD_REQUEST` with a `ValidationError` cause to it.
- `message` and `data` reach the user: no stack traces, SQL, paths or secrets.

## Pagination and lists

- Every list procedure is paginated. Never return an unbounded array.
- Use cursor pagination: input `{ cursor?: string, limit?: number }` with `limit` an integer from 1 to 100 defaulting to 50, output `{ items, nextCursor: string | null }`. The cursor is opaque to the client.
- Order is part of the contract and is stable and unique, ending in the id as tie-breaker.

## RunEvent and the runner protocol

- `RunEvent` is a discriminated union on `type`, with a payload per type, the run id, a timestamp and an event `id` that is comparable within a run. Browsers resume SSE after the last id, so a reader never misses a committed event.
- The runner protocol is the messages on the one WebSocket between control plane and runner: a discriminated union per direction, with the direction in its name, each message carrying the run id and the attempt.
- Adding an event type or message is a contract change. Every consumer that switches on `type` ends in a `never` check, so it fails the typecheck until handled.
- Agent output enters as untrusted text. The schema bounds its size, and the adapter maps vendor lines into these events. Vendor shapes never enter `contracts`.

## Plan mode

1. For each new or changed procedure, write its name, input, output, errors and whether it is paginated, in the step or under Decisions.
2. Settle contract changes before any parallel work, since the server, client and web steps all depend on them.
3. List every consumer that must change with a contract: the handler in `apps/api`, the hook in `packages/api-client`, and the screens or runner code that use it.

## Implement mode

Change `contracts` first, then the handler, the client and the callers, in one change. Add a schema test for each new schema: a valid case, each rejection, the bounds, and that an output strips an unknown key. Run the typecheck so the compiler shows every consumer.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `api-contract-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A new or changed procedure with no input, output and errors written down | `blocker` |
| A list procedure with no pagination, or a limit with no maximum | `blocker` |
| An output planned to carry a secret, hashed token or internal field | `blocker` |
| Contract changes not settled before steps that run in parallel | `should fix` |
| A consumer of a changed contract (handler, hook, screen or runner code) missing from the steps | `should fix` |
| A new RunEvent type or runner message with no fields named | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `api-contract-design` as the source skill.

| Check | Severity |
| --- | --- |
| A contract change is not reflected in the server handler or the client, or a type is duplicated outside `contracts` | `blocker` |
| A list without pagination, or a limit with no maximum | `blocker` |
| An output leaks a secret, a hashed token or an internal field | `blocker` |
| An input is not strict, not bounded, or uses `any` | `should fix` |
| A procedure with no `.output()`, a transform or `z.date()` in a contract, or a custom error code with no `status` | `should fix` |
| A procedure has errors in code that its contract does not name | `should fix` |
| A new RunEvent or message has no exhaustive handling in consumers | `should fix` |
| A new schema has no test, or a leftover schema has no user | `should fix` |
| Naming breaks the convention | `nit` |

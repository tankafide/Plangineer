---
name: api-contract-design
description: Designs the contracts for every shape that crosses a process boundary, including operations, input and output schemas, errors, pagination, and event and message types. Use when planning, implementing or reviewing a contract, operation or event.
disable-model-invocation: true
---

# API contract design

Every shape that crosses a process boundary is a schema in one shared contract, and every operation is built from those schemas. The server and the clients read the same contract.

<!-- slot: fact contract-technology: the contract and schema libraries with versions, where contracts live, and how the server and each client consume them -->

## Rules

- **One source.** Define each shape once and derive its types from the schema. Never hand-write a second type for a shape.
- **Naming.** Operations and schemas follow the naming in [project-stack](../project-stack/SKILL.md#conventions).
- **Input and output on every operation.** An operation without a declared output leaves its result untyped on the client. Omit the input only when an operation takes nothing.
- **Strict inputs.** Unknown keys fail. Ids have their exact format, every string and array has a minimum and maximum, and closed sets are enums or discriminated unions on `type` or `kind`, never free strings or untyped values unless the value is truly opaque.
- **Outputs expose no internals.** Outputs drop unknown keys, so an extra column never reaches the client. Never return hashed tokens, secrets or raw database rows.
- **JSON-safe, no transforms.** The same schemas parse stored documents and messages, so contracts hold no transforms, coercion or non-JSON types. Dates are ISO 8601 UTC strings.
- **Defaults.** A schema default exists only when the absent value has one meaning in the product.

## Errors

- Every operation declares each error code it can raise. Codes shared by every operation, such as unauthorized, forbidden and validation failed, are declared once.
- `message` and error data reach the user: no stack traces, SQL, paths or secrets.

<!-- slot: rule error-shape: how this contract technology declares and returns errors: shared and per-operation codes, HTTP status mapping, and the validation error data shape -->

## Pagination and lists

- Every list operation is paginated. Never return an unbounded array.
- Order is part of the contract and is stable and unique, ending in the id as tie-breaker.

<!-- slot: rule pagination: the pagination contract for list operations: cursor or page input, limit bounds and default, and output fields -->

## Events and messages

- An event or message type is a discriminated union on `type`, with a payload per type. A stream a reader resumes carries an id comparable within the stream, so a reader never misses a committed event.
- Adding an event type or message is a contract change. Every consumer that switches on `type` ends in an exhaustiveness check, so it fails the build until handled.
- Text from outside the system enters as untrusted, with its size bounded by the schema. Adapters map third-party shapes into these types. Third-party shapes never enter the contract.

## Plan mode

1. For each new or changed operation, write its name, input, output, errors and whether it is paginated, in the step or under Decisions.
2. Settle contract changes before any parallel work, since the server, client and UI steps all depend on them.
3. List every consumer that must change with a contract: the server handler, the client code, and the screens or other callers that use it.

## Implement mode

Change the contract first, then the handler, the client and the callers, in one change. Add a schema test for each new schema: a valid case, each rejection, the bounds, and that an output drops an unknown key. Run the `check` command in [project-stack](../project-stack/SKILL.md#commands) so the compiler shows every consumer.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `api-contract-design` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A new or changed operation with no input, output and errors written down | `blocker` |
| A list operation with no pagination, or a limit with no maximum | `blocker` |
| An output planned to carry a secret, hashed token or internal field | `blocker` |
| Contract changes not settled before steps that run in parallel | `should fix` |
| A consumer of a changed contract (handler, client, screen or other caller) missing from the steps | `should fix` |
| A new event or message type with no fields named | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `api-contract-design` as the source skill.

| Check | Severity |
| --- | --- |
| A contract change is not reflected in the server handler or the client, or a type is duplicated outside the contract | `blocker` |
| A list without pagination, or a limit with no maximum | `blocker` |
| An output leaks a secret, a hashed token or an internal field | `blocker` |
| An input is not strict, not bounded, or untyped | `should fix` |
| An operation with no declared output, a transform or non-JSON type in a contract, or a custom error code with no status | `should fix` |
| An operation has errors in code that its contract does not name | `should fix` |
| A new event or message type has no exhaustive handling in consumers | `should fix` |
| A new schema has no test, or a leftover schema has no user | `should fix` |
| Naming breaks the convention | `nit` |

---
name: testing
description: Plans test coverage for each "done when" line, writes tests across the repository, and reviews whether tests prove the plan. Used by planning, implementation, plan review and implementation review.
disable-model-invocation: true
---

# Testing

Tests prove the "done when" lines. Choose the smallest layer that proves each one. Tests never call a real model or a real third-party service. For the stack, see [project-stack](../project-stack/SKILL.md).

## Layers

<!-- slot: fact test-layers: a table of each test layer (unit, integration, component, end to end, agent check, human check) with its framework, what it proves, and where its test files live and how they are named -->

## Rules for every test

- Test observable behavior: return values, rendered output, stored rows, emitted events. Never assert on private calls or implementation details.
- Name a test for the behavior: `rejects a plan with no steps`, not `test1` or `works`. Group tests per unit.
- Arrange, act, assert, with one reason to fail per test. Table-driven cases for input variations.
- Fixtures are built by small factory functions with overrides, not shared mutable objects. Recorded fixtures live beside the tests that use them.
- No test-only methods or exports in production code, and no expected value computed by the code under test.
- Pin time with fake timers or an injected clock. Never sleep for real. In end-to-end tests, use assertions that retry until the condition holds, never a fixed wait.
- Tests are independent and run in any order, in parallel, on every platform the project supports.
- Keep the suite fast: unit tests in milliseconds, no network, no database below the integration layer.
- A skipped or `todo` test is not coverage. Do not commit one.
- There is no coverage percentage target. The "done when" lines are the measure, so never add a test only to raise coverage.
- Snapshots are inline and small, only for stable serialized output such as generated text. Never snapshot a whole component or response.

## Fakes

<!-- slot: rule fakes: what tests may fake (clock, network, models, random values and ids) and with which tool, and what they must never fake, such as the database or the repository's own modules -->

## Per area

<!-- slot: rule per-area: a table of each area of the repository and how its tests are written: layer, tools, fixtures and what to assert on -->

## Plan mode

1. For each "done when" line, pick the smallest layer that proves it. A pure rule is a unit test, a query or handler is integration, a state in the UI is a component test, and a user journey is end to end.
2. Tick the layers in the test plan grid as [plan-format](../plan-format/SKILL.md) defines it. Prefer automated layers. Use an agent check only for what no automated test can prove, and a human check only for what neither can judge. The goal is high confidence that every line holds, with as few human checks as possible.
3. Flag every row with no tick as a gap. Do not leave a gap and do not tick a layer that cannot prove the line.
4. Cover constraints and error paths, not only the happy path. Every error a contract names has a test.
5. Describe in one paragraph what each layer covers and the fixtures it needs. Name missing test infrastructure as work in a step.

## Implement mode

Write the test for each "done when" line with the code that satisfies it, using the layer the plan ticked. Write the failing test first for a bug fix. See every new test fail once, for the right reason, before the code makes it pass. A test that passes before the change proves nothing.

Never weaken a test to make it pass: do not loosen an assertion, change an expected value to match the output, or skip or delete a failing test. If the test itself was wrong, fix it and say why in the report.

Run the new tests, then the `check` command in [project-stack](../project-stack/SKILL.md#commands). Report any check that was not run, and never describe one as passed when it did not run.

<!-- slot: fact test-commands: the commands that run each test layer, a single test file and the end-to-end suite, and when each must run -->

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `testing` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A "done when" line with no tick in the test plan grid | `blocker` |
| A behavior planned against a fake the Fakes section forbids | `blocker` |
| A planned test that calls a real model or a real third-party service | `blocker` |
| A tick at a layer that cannot prove the line, such as a unit test for a query | `should fix` |
| Error paths and constraints the plan names with no test | `should fix` |
| Missing test infrastructure, such as a fixture or a fake, not named as work in a step | `should fix` |
| A human check where an automated test or an agent check could prove the line | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `testing` as the source skill. Check that the tests prove each "done when" line in the plan's test plan, and nothing more is claimed than ran.

| Check | Severity |
| --- | --- |
| A "done when" line has no test at the layer the plan ticked | `blocker` |
| A test uses a fake the Fakes section forbids where the plan says integration | `blocker` |
| A test calls a real model, or a real third-party service in the `check` command | `blocker` |
| A test weakened, skipped or deleted to make the change pass | `blocker` |
| A mock of the repository's own modules, or a test-only method in production code | `should fix` |
| A skipped or `todo` test, or coverage claimed in the description but not run | `should fix` |
| A weak assertion: only "does not throw", only a status, a snapshot of everything, or a mock call count | `should fix` |
| A test asserts implementation details, or depends on order, wall-clock time, a fixed wait or the platform | `should fix` |
| A new error path, boundary or state has no test | `should fix` |
| Vague test names, or duplicated fixtures a factory would remove | `nit` |

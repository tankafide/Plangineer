---
name: testing
description: Plan test coverage for each "done when" line, write tests across the repo, and review whether tests prove the plan. Covers Vitest, real Postgres, MSW, Playwright and the fake agent.
disable-model-invocation: true
---

# Testing

Tests prove the "done when" lines. Choose the smallest layer that proves each one. Tests never call a real model.

## Layers

| Layer | Tool | Proves | Used in |
| --- | --- | --- | --- |
| Unit | Vitest 5 | One function or module, with no I/O | `domain`, `contracts`, and pure code anywhere |
| Integration | Vitest against real Postgres | Handlers, queries and transactions together | `apps/api` |
| Component | Vitest with Testing Library (`@testing-library/react` and `user-event`) on jsdom | A component's states and interactions | `apps/web` |
| End to end | Playwright Test | A journey through the real UI and API on seeded data | A few critical journeys |
| Agent check | `playwright-cli` screenshots, API calls, CLI runs | What a script cannot judge, such as layout at 375 px and desktop | UI work, commands |
| Human check | A person | Taste, product fit, anything an agent cannot judge | Only what is left |

## Rules for every test

- Test observable behavior: return values, rendered output, stored rows, emitted events. Never assert on private calls or implementation details.
- Name a test for the behavior: `rejects a plan with no steps`, not `test1` or `works`. Group with `describe` per unit.
- Arrange, act, assert, with one reason to fail per test. Table-driven `it.each` for input variations.
- Fixtures are built by small factory functions with overrides, not shared mutable objects. Recorded JSONL runner fixtures live beside the tests that use them.
- Fake only the clock, the network (MSW), the model (the fake agent) and random values and ids. Never the database, and never `vi.mock` the repository's own modules.
- No test-only methods or exports in production code, and no expected value computed by the code under test.
- Pin time with Vitest fake timers or an injected clock. Never sleep for real. In Playwright, use web-first assertions such as `expect(locator).toBeVisible()` that retry, never `waitForTimeout`.
- Tests are independent and run in any order, in parallel, on Windows, macOS and Linux. Paths come from `node:path`.
- Keep the suite fast: unit tests in milliseconds, no network, no database below the integration layer.
- A skipped or `todo` test is not coverage. Do not commit one.
- There is no coverage percentage target. The "done when" lines are the measure, so never add a test only to raise coverage.
- Snapshots are inline and small, only for stable serialized output such as generated text. Never snapshot a whole component or response.
- Tests sit beside their source as `<name>.test.ts`, and component tests as `<name>.test.tsx`. Journeys live in `apps/web/e2e/<journey>.spec.ts`.

## Per area

| Area | How |
| --- | --- |
| `domain` | Exhaustive unit tests: every branch, boundary and variant, table-driven |
| `api` | Integration tests on real Postgres through template databases, never PGlite or a mocked database. Call procedures through the oRPC router. Assert on rows, not only on responses |
| `runner` | The fake agent and recorded JSONL fixtures. Never a real `claude` or `codex` process or model call |
| GitHub and other HTTP | MSW handlers, with each response typed from the real shape. Keep mocked-network tests apart from any test that calls a real API, and never run the real-API ones in `pnpm verify` |
| `web` | Vitest components queried by role and label, not by class or test id first. Cover each of the five states in [frontend-react](../frontend-react/SKILL.md). Mock the network with MSW |
| Journeys | Playwright Test on seeded data from `pnpm db:reset`, one file per journey, run with `pnpm test:e2e` |
| UI appearance | `playwright-cli` screenshots at desktop and 375 px, reviewed before the work is done |

## Plan mode

1. For each "done when" line, pick the smallest layer that proves it. A pure rule is a unit test, a query or handler is integration, a state in the UI is a component test, and a user journey is end to end.
2. Tick the layers in the test plan grid as [plan-format](../plan-format/SKILL.md) defines it. Prefer automated layers. Use an agent check only for what no automated test can prove, and a human check only for what neither can judge. The goal is high confidence that every line holds, with as few human checks as possible.
3. Flag every row with no tick as a gap. Do not leave a gap and do not tick a layer that cannot prove the line.
4. Cover constraints and error paths, not only the happy path. Every error a contract names has a test.
5. Describe in one paragraph what each layer covers and the fixtures it needs. Name missing test infrastructure as work in a step.

## Implement mode

Write the test for each "done when" line with the code that satisfies it, using the layer the plan ticked. Write the failing test first for a bug fix. See every new test fail once, for the right reason, before the code makes it pass. A test that passes before the change proves nothing.

Never weaken a test to make it pass: do not loosen an assertion, change an expected value to match the output, or skip or delete a failing test. If the test itself was wrong, fix it and say why in the report.

Run the new tests and then `pnpm verify`. Run `pnpm test:e2e` when a journey was added or changed. Report any check that was not run, and never describe one as passed when it did not run.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `testing` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A "done when" line with no tick in the test plan grid | `blocker` |
| A database behavior planned for anything but real Postgres | `blocker` |
| A planned test that calls a real model | `blocker` |
| A tick at a layer that cannot prove the line, such as a unit test for a query | `should fix` |
| Error paths and constraints the plan names with no test | `should fix` |
| Missing test infrastructure, such as a fixture or the fake agent, not named as work in a step | `should fix` |
| A human check where an automated test or an agent check could prove the line | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `testing` as the source skill. Check that the tests prove each "done when" line in the plan's test plan, and nothing more is claimed than ran.

| Check | Severity |
| --- | --- |
| A "done when" line has no test at the layer the plan ticked | `blocker` |
| A database test uses a mock, PGlite or an in-memory fake where the plan says integration | `blocker` |
| A test calls a real model, or a real API in `pnpm verify` | `blocker` |
| A test weakened, skipped or deleted to make the change pass | `blocker` |
| A mock of the database or of the repository's own modules, or a test-only method in production code | `should fix` |
| A skipped or `todo` test, or coverage claimed in the description but not run | `should fix` |
| A weak assertion: only "does not throw", only a status, a snapshot of everything, or a mock call count | `should fix` |
| A test asserts implementation details, or depends on order, wall-clock time, `waitForTimeout` or the platform | `should fix` |
| A new error path, boundary or state has no test | `should fix` |
| Vague test names, or duplicated fixtures a factory would remove | `nit` |

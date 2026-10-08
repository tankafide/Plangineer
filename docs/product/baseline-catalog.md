# Baseline catalog

Oct 8, 2026

Repository setup recommends skills from this catalog of 21. Each skill follows the [skill specification](skill-specification.md), and the scan recommends one when the repository shows its signal.

## Skills

A skill's kind sets where its text comes from:

| Kind | Source |
| --- | --- |
| `fixed` | Ships as Plangineer writes it |
| `template` | Ships with slots the setup agent fills from the repository |
| `generated` | The setup agent writes the whole skill from the repository's code |

A skill with the signal "Always" is recommended for every repository. Any other skill is recommended on its first matching signal, checked in the order directories, file names, extensions, dependencies. A directory matches any path segment, a file name matches a path's last segment, an extension matches a path's end, and a dependency matches a `package.json` dependency name exactly.

A required skill is chosen whenever any orchestrator is chosen, because the orchestrator templates link to it.

| Name | Kind | Purpose | Signal | Required |
| --- | --- | --- | --- | :-: |
| `codebase-exploration` | fixed | How to explore the repository before planning, and what a context file holds | Always | ✓ |
| `plan-format` | fixed | The plan template and its blocker checklist | Always | ✓ |
| `writing-style` | fixed | How plans, pull request descriptions and docs read | Always | ✓ |
| `finding-verification` | fixed | How review findings are verified before anyone fixes them | Always | ✓ |
| `plan-conformance` | fixed | Matching a diff to its plan, with deviations and extras | Always | ✓ |
| `project-stack` | template | The repository's context, stack, layout, commands and conventions | Always | ✓ |
| `architecture-design` | template | Where code belongs and what may import what | Always | ✓ |
| `testing` | template | Test layers, what each proves, and the fixtures each uses | Always | ✓ |
| `code-quality` | template | Naming, unit size, types, error handling and dead code | Always | ✓ |
| `debugging` | template | Reproducing, isolating and fixing a root cause | Always | ✓ |
| `security` | template | Trust boundaries, input handling and secrets | Always | |
| `performance` | template | Standing performance limits and how each is checked | Always | |
| `data-model-design` | template | Tables, constraints, indexes and migrations | Directory `migrations`; file `schema.prisma`, `alembic.ini` or `drizzle.config.ts`; dependency `prisma`, `drizzle-orm`, `typeorm`, `sequelize`, `knex` or `mongoose` | |
| `api-contract-design` | template | Endpoints, schemas, errors and compatibility | File `openapi.yaml` or `openapi.json`; extension `.proto` or `.graphql`; dependency `express`, `fastify`, `hono`, `koa`, `@nestjs/core`, `@trpc/server` or `@orpc/server` | |
| `backend` | generated | Server layers, request handling, errors, configuration and logging | Dependency `express`, `fastify`, `hono`, `koa`, `@nestjs/core` or `next` | |
| `database-access` | generated | Queries, transactions, seed data and database tests | Dependency `prisma`, `@prisma/client`, `drizzle-orm`, `typeorm`, `sequelize`, `knex` or `mongoose` | |
| `frontend` | generated | Components, routing, forms, screen states and accessibility | Extension `.tsx`, `.jsx`, `.vue` or `.svelte`; dependency `react`, `vue`, `svelte`, `@angular/core` or `solid-js` | |
| `frontend-data` | generated | Server state, caching and realtime updates in the client | Dependency `@tanstack/react-query`, `swr`, `@apollo/client`, `@reduxjs/toolkit` or `urql` | |
| `design-system` | generated | Layout, the component library, tokens and theming | File `components.json`, `tailwind.config.js` or `tailwind.config.ts`; dependency `tailwindcss`, `@mui/material`, `@chakra-ui/react` or `@mantine/core` | |
| `auth` | generated | Sign-in, sessions, roles and access checks | Dependency `better-auth`, `next-auth`, `@auth/core`, `passport`, `lucia`, `@clerk/nextjs` or `@clerk/clerk-react` | |
| `tooling-and-ci` | generated | The package manager, workspace, hooks, CI and the parts of the check command | Directory `.github`; file `turbo.json`, `nx.json`, `pnpm-workspace.yaml`, `lefthook.yml` or `.pre-commit-config.yaml` | |

## Routing

Each orchestrator routes a chosen skill with the "applies when" text of its row. Most rows come from Plangineer's own orchestrators. The rows for `project-stack` and the generated skills are new.

| Skill | Orchestrator | Applies when |
| --- | --- | --- |
| `project-stack` | all four | Always: the repository's stack, layout, commands and conventions |
| `codebase-exploration` | plan | No exploration context files were provided. Run explore mode in a subagent unless the exploration is trivial |
| `codebase-exploration` | plan review | Always, in verify mode, in a subagent unless the check is trivial |
| `codebase-exploration` | implementation | No plan, and the area is unfamiliar or large. Run explore mode in a subagent, with the work branch as the base when it already has commits |
| `plan-format` | plan | Drafting the plan and checking it for blockers |
| `plan-format` | plan review | Checking the plan's structure, "done when" lines and blocker checklist, and updating the plan |
| `writing-style` | plan | Drafting and revising the plan's prose |
| `writing-style` | plan review | Checking the plan's prose, and updating the plan. Style breaks are nits |
| `writing-style` | implementation | Writing the pull request description |
| `finding-verification` | plan review, implementation review | Always, in a subagent, before the engineer sees any finding |
| `plan-conformance` | implementation review | Always when there is a plan |
| `code-quality` | implementation review | Always |
| `architecture-design` | plan, plan review | The plan adds or moves code, adds a package or module, or changes dependencies |
| `architecture-design` | implementation | The change adds or moves code, adds a package or module, or changes dependencies |
| `architecture-design` | implementation review | The diff adds or moves code, adds a package or module, or changes dependencies, or the recorded decisions cover it |
| `api-contract-design` | plan, plan review | The plan adds or changes a contract, procedure or event |
| `api-contract-design` | implementation | The change adds or changes a contract, procedure or event |
| `api-contract-design` | implementation review | The diff adds or changes a contract, procedure or event, or the recorded decisions cover it |
| `data-model-design` | plan, plan review | The plan adds or changes a table, constraint, index or migration |
| `data-model-design` | implementation | The change adds or changes a table, constraint, index or migration |
| `data-model-design` | implementation review | The diff adds or changes a table, constraint, index or migration, or the recorded decisions cover it |
| `testing` | plan | Filling the test plan grid, once the "done when" lines are settled |
| `testing` | plan review | Checking that the test plan covers every "done when" line |
| `testing` | implementation | Writing tests, once per phase |
| `testing` | implementation review | The diff adds or changes tests, or changes behavior |
| `security` | plan review | The plan adds a trust boundary, such as authentication, a webhook or untrusted input |
| `security` | implementation review | The diff touches a trust boundary, secrets or untrusted input |
| `performance` | plan review | The plan adds queries, lists, realtime delivery or heavy frontend work |
| `performance` | implementation review | The diff touches queries, lists, realtime delivery or heavy frontend work |
| `debugging` | implementation | The request is a bug fix |
| `debugging` | implementation review | Fixing a selected defect that is a bug |
| `backend` | implementation | The change is in server handlers, middleware, configuration or logging |
| `backend` | implementation review | The diff touches server handlers, middleware, configuration or logging |
| `database-access` | implementation | The change writes queries, transactions or seed data |
| `database-access` | implementation review | The diff touches queries, transactions or seed data |
| `frontend` | implementation | The change is in components or routes |
| `frontend` | implementation review | The diff touches components or routes |
| `frontend-data` | implementation | The change touches server state, caching or realtime updates in the client |
| `frontend-data` | implementation review | The diff touches server state, caching or realtime updates in the client |
| `design-system` | plan, plan review | The plan touches screens or components |
| `design-system` | implementation | The change touches screens or components |
| `design-system` | implementation review | The diff touches screens or components |
| `auth` | implementation | The change touches sign-in, sessions or roles |
| `auth` | implementation review | The diff touches sign-in, sessions or roles |
| `tooling-and-ci` | implementation | The change touches the workspace, scripts, hooks, CI or check configuration |
| `tooling-and-ci` | implementation review | The diff touches the workspace, scripts, hooks, CI or check configuration |

---
name: tooling-and-infra
description: The pnpm workspace, Turborepo, local dev stack, scripts, lefthook, CI matrix and check configuration, and adding each new check to pnpm verify. Implement and review modes.
disable-model-invocation: true
---

# Tooling and infrastructure

Rules for the workspace, scripts, hooks, CI and check configuration. The stack and commands are in [stack decisions](../../../docs/engineering/stack-decisions.md). Scripts and config also follow `cross-platform`. Environment parsing and logging belong to `api-server`.

## Implement mode

### Workspace

- Packages live under `packages/*` and `apps/*`, as the stack's package layout lists them. `pnpm-workspace.yaml` holds the workspace globs and every pnpm setting. No `.npmrc`.
- Each package declares every dependency it imports. Internal dependencies use `workspace:*`. Never hoist to hide an undeclared import.
- The root `package.json` pins `packageManager` to an exact pnpm version and sets `engines.node` to `>=24 <25`. Commit `pnpm-lock.yaml`.
- pnpm 10 blocks dependency install scripts. List every package that has one in the `allowBuilds` map in `pnpm-workspace.yaml`: `true` when its script must run, `false` when it is not needed, with the reason in a YAML comment. Never set `dangerouslyAllowAllBuilds`.
- Turborepo 2 runs in strict env mode, so a task sees only variables named in its `env` or in `globalEnv`. Declare each variable a task reads, and list `.env*` files it loads in `inputs`, or the cache returns stale results.
- Every cached task declares `outputs`, and `build` depends on `^build`. Long-running tasks such as `dev` set `cache: false` and `persistent: true`.

### Scripts

- Repo scripts are `scripts/<kebab-name>.mjs`, run as `node scripts/<name>.mjs`.
- No shell syntax in `package.json` scripts: no `&&`, `|`, `$VAR`, `>`, `rm`, `cp` or shell globs. A script that needs more than one command becomes a Node script.
- Run a package's CLI by resolving its JavaScript bin with `binPath` from `scripts/bin-path.mjs` and spawning it with `process.execPath`, as `scripts/verify.mjs` does. Use `execa` for anything else. Never spawn a `.cmd` shim or use `shell: true`.
- A script exits non-zero on any failure and prints what failed and the fix. Mutating commands (`format`, `skills:sync`) are separate scripts from read-only checks (`format:check`, `skills:check`).
- A script that holds logic has a Vitest test beside it, as `scripts/lint-skills.test.mjs` does.
- `skills:lint` runs the runner's `skills lint` first, which checks each skill's file rules and links, then `scripts/lint-skills.mjs`'s own routing, delegation and references checks.

### Local stack

- `pnpm dev` is a Node script. It runs `docker info` first, starts Postgres and MinIO with Docker Compose, waits for both healthchecks, then starts the API and web with seed data. `pnpm runner:fake` runs the paired runner with the fake agent beside it, so runs need no model.
- `compose.yaml` pins image tags (Postgres at the production major, never `latest`), uses named volumes and gives each service a healthcheck.
- `pnpm db:reset` drops, migrates and reseeds the dev database. It refuses a `DATABASE_URL` whose host is not local.
- If Docker is down or a container fails, report it. Do not restart Docker or prune volumes.

### Hooks

- `lefthook.yml` holds every hook, and each command is a Node script, `node scripts/<name>.mjs`, or the runner's CLI, `node apps/runner/src/cli.ts`. Scope a command to its files with `glob`, as `skills-lint` does.
- A hook never mutates files and never uses `stage_fixed`, because it can overwrite an unstaged edit.
- Hooks inherit git's repository-local variables, such as `GIT_DIR`, listed by `git rev-parse --local-env-vars`. A hook command that runs git in another repository, as tests do, deletes them first.
- Create worktrees with `pnpm worktree:new`, which copies the ignored `.env`.
- Pre-commit checks the staged files (`skills check --staged`), not the working tree.
- Pre-push runs `node scripts/verify.mjs`, so a failing `pnpm verify` stops the push.
- `prepare` runs `lefthook install`. Hooks can be skipped with `--no-verify`, so CI is the gate.
- `.claude/settings.json` registers two Claude Code hooks. `PostToolUse` on `Edit|Write` runs `scripts/claude-post-edit.mjs`, which format-checks and lints the edited file and never rewrites it. `Stop` runs `scripts/claude-stop.mjs`, which runs `pnpm verify` unless the stop hook is already active or every changed path is under `docs/`. Both exit 2 on failure, the only code that blocks, so the output reaches the agent.
- A Claude Code hook command names its script as `node "${CLAUDE_PROJECT_DIR}/scripts/<name>.mjs"`. Hooks run in the session's current directory, so a relative path breaks after the agent changes directory.

### CI

- One workflow runs `pnpm verify` on a matrix of `ubuntu-latest`, `macos-latest` and `windows-latest` with `fail-fast: false`. The three matrix jobs are the required checks for merging.
- The same workflow runs `pnpm test:e2e` on `ubuntu-latest` only, since the macOS and Windows runners have no Linux Docker, and a `bundle` job that runs `pnpm build` and `node scripts/smoke-server-bundle.mjs` on all three systems with no `.env`.
- `desktop.yml` runs `pnpm desktop:build` and the desktop `test:stack` on Windows x64, macOS arm64 and x64, and Linux x64, on pull requests that touch `apps/`, `packages/` or `scripts/`. On a `v*` tag it uploads the installers to one draft release.
- Steps: checkout, `pnpm/action-setup` with no `version` input (it reads `packageManager`), `actions/setup-node` with Node 24 and `cache: pnpm`, `pnpm install --frozen-lockfile`, then `pnpm verify`. `pnpm/action-setup` runs before `setup-node`, or the pnpm cache step fails.
- The workflow sets `permissions: contents: read` and a `concurrency` group with `cancel-in-progress: true` for pull requests.
- Each job installs Postgres natively with `ikalnytskyi/action-setup-postgres`, at the major `compose.yaml` pins, because Windows and macOS runners cannot run the Linux container. No integration test is skipped on any system.
- `pnpm verify` needs no MinIO. S3 calls are tested with MSW, as `api-server` says.

### Check configuration

| Check | Configuration |
| --- | --- |
| Oxlint with tsgolint | `.oxlintrc.json`, correctness rules as errors, run type-aware with type-check on |
| Oxfmt | `.oxfmtrc.json`. Check and write are separate scripts |
| Typecheck | TypeScript 7, one strictest root `tsconfig` extended by each package |
| dependency-cruiser | `.dependency-cruiser.cjs` encodes the package layout table, `no-circular`, and no imports into another package's `src/`. Each `forbidden` rule has a `comment` saying what to import instead |
| Knip | `knip.json` with one entry per workspace. Unused files, exports and dependencies fail the check |
| Vitest | Projects config, so each package runs its own tests |

Never silence a rule to make a check pass. Fix the code, or change the rule in the same change and give the reason.

### Adding a check to `pnpm verify`

1. Add a step to the `steps` list in `scripts/verify.mjs`: a name and the Node arguments that run it. Put fast checks first.
2. Add a root `package.json` script for it if people run it alone.
3. Name it in the `pnpm verify` row of [stack decisions](../../../docs/engineering/stack-decisions.md) if it is not there. `implementation-orchestrator` reports any check that row names and the script does not run.

## Review mode

Check a diff against these rules. Report each breach as a finding in the shared [finding format](../orchestrator-references/finding-format.md), with source skill `tooling-and-infra`.

| Rule | Severity if broken |
| --- | --- |
| Shell syntax in a `package.json` script, or a repo script that is not a Node file | blocker |
| `.claude/skills/` edited by hand | blocker |
| A hook that mutates files, or a hook command that is not a Node script | blocker |
| A check or lint rule disabled, loosened or skipped to get green, with no reason | blocker |
| The CI matrix drops one of the three systems, enables `fail-fast`, skips integration tests on a system, or does not run `pnpm verify` | blocker |
| `dangerouslyAllowAllBuilds`, a dependency install script missing from `allowBuilds`, or a pnpm setting in `.npmrc` | should fix |
| A Claude Code hook that rewrites files, uses a relative script path, or blocks with an exit code other than 2 | should fix |
| The pre-push `pnpm verify` removed or skipped | should fix |
| A workspace package imports a dependency it does not declare, or uses a version range where `workspace:*` is required | should fix |
| A Turborepo task that reads a variable or `.env` file missing from its `env`, `globalEnv` or `inputs`, or a cached task with no `outputs` | should fix |
| A new check not in `scripts/verify.mjs`, or missing from the `pnpm verify` row in the stack decisions | should fix |
| A Compose image on `latest`, a service with no healthcheck, or `db:reset` able to run against a non-local database | should fix |
| A script with logic and no test, or a script that exits zero after a failure | should fix |
| A CI workflow with no `permissions` block, or `pnpm/action-setup` given a `version` | nit |

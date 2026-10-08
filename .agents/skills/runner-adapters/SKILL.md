---
name: runner-adapters
description: The local runner in apps/runner, its control-plane connection, worktrees, the job queue, the skills sync and check commands, and one adapter per agent CLI that emits RunEvents. Use when implementing or reviewing code in apps/runner or an agent CLI adapter.
disable-model-invocation: true
---

# Runner adapters

Rules for `apps/runner`, the npm package an engineer installs to run agents on their own machine. It imports `contracts` and `domain` only. Its protocol with the control plane is in [run-orchestration](../run-orchestration/SKILL.md), pairing and the vendor login rule in [auth-and-access](../auth-and-access/SKILL.md), and spawning, stopping, paths and line endings in [cross-platform](../cross-platform/SKILL.md).

## Implement mode

### Shape

| Part | Rule |
| --- | --- |
| Package | Node 24, published to npm as `plangineer-runner` with `pnpm runner:publish`, one `bin` entry. It ships JavaScript built by tsdown, with `contracts` bundled in. The plan that adds the CLI names its commands |
| Config and data | Under `env-paths`. The runner holds no state beyond its pairing token and worktrees |
| Environment | Parsed with a Zod schema at startup. A missing or invalid variable exits with a message |
| Logs | pino as JSON to stdout and `logs/runner.log` |

### Connection

- The runner dials one outbound WebSocket and opens no inbound port.
- On connect it reports each installed CLI's version (`claude --version`, `codex --version`), its concurrency limit and its platform. A CLI older than the adapter's minimum version is reported unavailable with the version it needs.
- A revoked or invalid token stops the runner with a clear message. It never retries with another credential.
- On its own shutdown (`SIGINT` or `SIGTERM`), the runner stops every running job through the stop function and sends their terminal events before it exits. Children are spawned detached, so nothing else stops them.

### Worktrees

- One worktree per feature and repository, under the runner's data directory and never inside the engineer's working copy. Create it with `git worktree add` from the feature branch.
- Git refuses a branch checked out in another worktree. Fail the job with that message. Never pass `--force` or `--ignore-other-worktrees`.
- Serialize git commands per repository. Parallel `worktree add` calls race on the repository's lock files.
- A job over several repositories gets one worktree for each.
- The runner writes the approved plan revision into the workspace, outside Git's tracked files, so it is never committed.
- One function removes a worktree, with `git worktree remove` then `git worktree prune`, for a passed, failed and cancelled run alike. The plan decides when a feature's worktrees are removed.
- Before every run except setup, run `skills check` on the checkout. A drifted mirror fails the run with the file and the fix. A setup run skips it, since setup is what repairs the mirror.

### Job queue

- Accept jobs into an in-memory queue. Run up to the configured concurrency limit and hold the rest.
- Report what is queued and running, and report a vendor plan limit, so the control plane stops dispatching.
- Heartbeat while a job runs. On a lost connection, keep the child running, buffer its events, reconnect, and resend from the last event the server acknowledged.
- Act on a cancel from the control plane, whether pushed or read from a heartbeat reply, by calling the stop function.

### Skills commands

`skills sync` and `skills check` mirror `.agents/skills/` to `.claude/skills/`, one way.

- `sync` copies every file, normalizes line endings to LF, deletes mirror files with no source, refuses symlinks and writes only files that changed.
- `check` writes nothing. It exits non-zero on any missing, changed or stray mirror file, naming each one and the fix: edit the file under `.agents/skills/`, then sync. A difference only in line endings is not drift.

### Adapters

One adapter per CLI, behind one interface in `src/adapters/`: given a job, it starts the CLI and yields `RunEvent` values from `contracts`. Nothing outside an adapter knows a vendor's flags or output shape.

| Adapter | Command | Rules |
| --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --verbose --permission-mode <mode> --permission-prompts none` | Never `--bare`: it skips `.claude/skills/` and ignores the engineer's subscription login. `system/init` is not always the first line. A failure inside the run arrives as a `result` line with `is_error` and a non-zero exit. Subagent messages carry `parent_tool_use_id` |
| Codex, later | `codex exec --json --sandbox <mode> -` | The default sandbox is read-only. `--full-auto` is deprecated. Map `thread.started`, `turn.*`, `item.*` and `error`. Progress goes to stderr. Needs a git repository |

- The plan names the permission mode and sandbox. Never leave either to the CLI's default, which varies by version and user settings.
- Spawn with execa, the prompt on stdin through `input`, `cwd` set to the worktree, and `buffer: false`. Default buffering fails a long run at `maxBuffer`.
- Iterate stdout by line. Validate each mapped event with the `RunEvent` schema and drop nothing. A vendor event with no mapping becomes the generic event type `contracts` defines. A line that is not JSON fails the run loudly.
- Number each event per run with an increasing sequence, so the server can resume and de-duplicate.
- Emit exactly one terminal `RunEvent` per run: success, failure or cancellation. On failure, record the exit code and the last stderr lines, kept in a bounded buffer.
- Cancel through the stop function in [cross-platform](../cross-platform/SKILL.md). Claude Code finishes its turn on `SIGINT` but exits 143 with no `result` on `SIGTERM`. Windows stops at once with no `result`, so the adapter, not the CLI output, emits the cancelled event.
- The child receives only the environment allowlist from [auth-and-access](../auth-and-access/SKILL.md#the-vendor-login-rule).

### Fake agent and fixtures

- A fake agent, a small Node script with the same command shape, replays a scripted event sequence. `pnpm dev` and every runner test use it. Tests never call a real model.
- Adapter tests replay recorded JSONL fixtures from real CLI runs under `src/adapters/__fixtures__/`, kept per CLI version. Record a new fixture when a CLI version changes the output.
- Cover: a normal run, a failed run, a cancelled run, a non-JSON line, a CLI that exits with no `result`, an unmapped event type, and CRLF in the output. Test the process-group stop on the platform CI runs, and the `taskkill` command line on Windows.

## Review mode

Raise findings with Source skill `runner-adapters`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| Code reads, copies, stores, logs or sends a vendor login or token | blocker |
| `shell: true`, a command built as a string, or user text in an argument without an array | blocker |
| A stop that kills only the parent process, or uses a POSIX signal on Windows | blocker |
| `apps/runner` imports another app or anything but `contracts` and `domain` | blocker |
| An inbound port opened | blocker |
| A test that calls a real model | blocker |
| `claude --bare`, or a permission mode or sandbox left to the CLI default | blocker |
| `--force` on a worktree command, or git commands on one repository run in parallel | should fix |
| A vendor flag or output shape handled outside its adapter | should fix |
| A job that ends without exactly one terminal event, or an invalid line silently skipped | should fix |
| Child output buffered whole instead of streamed with `buffer: false` | should fix |
| Runner shutdown that leaves running children behind | should fix |
| A worktree inside the engineer's working copy, or a code path that never removes one | should fix |
| Hard-coded paths or `~` instead of `node:path` and `env-paths` | should fix |
| A queue with no concurrency limit, or no heartbeat while a job runs | should fix |
| A second skills mirror implementation beside the runner commands | should fix |
| An adapter with no fixture test | should fix |

# Plangineer runner and agent-CLI integration (as of 2026-10-06)

Method note: ~22 tool calls. Primary docs were fetched for Claude Code, Codex, Cursor, ACP, Bun and the Open-Inspect and Open SWE repos. WebFetch returns model-summarised pages, so exact flag spellings should be re-verified against `--help` of the pinned CLI versions before coding. Items I could not source are in Gaps; recommendations are in Inferences only.

## 1. Exact non-interactive flags, output formats and their stability (Claude Code, Codex, Cursor)

### Takeaway
All three CLIs offer a headless mode with NDJSON event streams, but only Claude Code and Cursor document a stability posture. Claude Code's stream-json is the richest and most heavily versioned (feature-detect via `system/init.capabilities`). Codex's `--json` is simpler and its richer, schema-generated surface is `codex app-server`. Cursor's stream-json is the thinnest (tool events limited, thinking suppressed).

### Cited Findings

**Claude Code (CLI versions referenced in docs: v2.1.205 to v2.1.286)**
- `claude -p "<prompt>"` runs non-interactively. Exit code is 0 on success, non-zero on failure. Failures inside a run (e.g. missing auth) are printed as the result on stdout. — [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- `--output-format text|json|stream-json`. `json` returns result, session ID, `total_cost_usd` and per-model breakdown (client-side estimates, may differ from bill). `stream-json` is newline-delimited JSON; the last line is a `result` message with final text, cost and session metadata. — [headless](https://code.claude.com/docs/en/headless)
- Streaming needs `--output-format stream-json --verbose --include-partial-messages` for token deltas (`stream_event` with `delta.type == text_delta`). — [headless](https://code.claude.com/docs/en/headless)
- `--json-schema '<schema>'` with `--output-format json` puts a validated object in `structured_output`; invalid schema exits with an error (before v2.1.205 it was silently ignored). — [headless](https://code.claude.com/docs/en/headless)
- `system/init` is first event and carries model, tools, MCP servers, plugins, and (v2.1.205+) a `capabilities` string array intended for feature detection instead of version comparison. `mcp_server_errors` (v2.1.219+) and `plugin_errors` expose config failures. — [headless](https://code.claude.com/docs/en/headless)
- Other event types: `system/api_retry` (attempt, max_retries, retry_delay_ms, error category incl. `rate_limit`, `authentication_failed`, `billing_error`), `permission_denied` system messages and `permission_denials` in the result, subagent messages tagged by `parent_tool_use_id`; `--forward-subagent-text` (v2.1.211+) forwards subagent text/thinking. — [headless](https://code.claude.com/docs/en/headless)
- Permissions: `--allowedTools "Bash,Read,Edit"` (rule syntax e.g. `Bash(git diff *)`), `--permission-mode` values include `auto`, `dontAsk` (deny anything that would prompt, for locked-down CI), `acceptEdits`; `--permission-prompts none` (v2.1.259+) denies unresolved prompts and removes `AskUserQuestion`. A run with no mode set takes a built-in starting mode that "can be auto", so pass the mode explicitly. — [headless](https://code.claude.com/docs/en/headless)
- `--bare` skips auto-discovery of hooks, skills, plugins, MCP, memory and CLAUDE.md and never reads OAuth/keychain, so it needs `ANTHROPIC_API_KEY`; Anthropic says it will become the default for `-p` in future. This means `--bare` is incompatible with subscription login and with repo skills (skills only via `--add-dir`/plugin flags). — [headless](https://code.claude.com/docs/en/headless)
- Without `--bare`, `-p` runs project hooks from `.claude/settings.json` and connects `.mcp.json` servers even in untrusted folders, with no trust dialog. — [headless](https://code.claude.com/docs/en/headless)
- Skills: `/skill-name` in the prompt string is expanded in `-p` mode. Skills load from `.claude/skills/`. — [headless](https://code.claude.com/docs/en/headless)
- Sessions: `--resume <session_id>`, `--continue`; sessions can be resumed from any directory on the machine (v2.1.223+); `--resume` also accepts a transcript .jsonl path. — [headless](https://code.claude.com/docs/en/headless)
- Cancellation: SIGTERM exits 143, kills the Bash process tree, records no result for the in-flight turn; SIGINT (or SDK `interrupt()`) ends the turn cleanly. Background Bash tasks are killed ~5 s after result; background subagents keep `-p` open up to a 10 min idle ceiling (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). Piped stdin capped at 10 MB. — [headless](https://code.claude.com/docs/en/headless)
- If the working directory is deleted mid-session the run continues and emits a warning message. — [headless](https://code.claude.com/docs/en/headless)

**Codex CLI (`codex exec`)**
- `codex exec "<prompt>"`; `--json` streams JSON Lines; `-o/--output-last-message <path>`; `--output-schema <path>` enforces JSON Schema on final response; `-C <path>`; `--model`; `--ephemeral`; `--sandbox workspace-write|danger-full-access`; `--skip-git-repo-check`; `--ignore-user-config`; `--ignore-rules`; `codex exec resume --last|<SESSION_ID>`. `--full-auto` is deprecated in favour of `--sandbox workspace-write`. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- JSONL events: `thread.started`, `turn.started`, `turn.completed` (usage: input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens), `item.started/completed/failed`; item types `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `plan_update`. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- Prompt can come from stdin (`-` or no argument). A git repo is required unless overridden. An MCP server with `required = true` that fails makes `codex exec` exit with error. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- CI auth: `CODEX_API_KEY` inline for the invocation only, or seed `~/.codex/auth.json` for ChatGPT-managed auth; an official GitHub Action exists (`openai/codex-action`). — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- `codex app-server` (JSON-RPC 2.0, newline-delimited over stdio by default; WebSocket and Unix sockets exist but WebSocket is "experimental and unsupported for production"): `thread/start`, `turn/start`, `turn/interrupt`, `turn/steer`, `approvalPolicy` (`never`/`onRequest`/`unlessTrusted`), approval requests as server requests, and `codex app-server generate-ts|generate-json-schema --out` to emit version-matched schemas. Most APIs stable; some need `experimentalApi: true`. — [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- The TypeScript SDK `@openai/codex-sdk` reportedly spawns `codex app-server` over stdio (third-party blog; CLI v0.136 added `--stdio`). — [search result summary, danielvaughan.com](https://codex.danielvaughan.com/2026/06/03/codex-app-server-stdio-subprocess-embedding-custom-clients-json-rpc-protocol/) (secondary source, not verified against OpenAI docs)

**Cursor CLI (`agent` / `cursor-agent`)**
- `-p/--print`, `--output-format text|json|stream-json` (only valid with print), `--stream-partial-output`, `--force`/`--yolo` to allow file writes without confirmation, `--model`, `--resume`. Auth by `CURSOR_API_KEY` or browser login. — [Cursor headless](https://cursor.com/docs/cli/headless), [Cursor authentication](https://cursor.com/docs/cli/reference/authentication) (latter via MVP doc)
- stream-json events: `system/init` (apiKeySource, cwd, session_id, model, permissionMode), `user`, `assistant` (with `--stream-partial-output` use only deltas with `timestamp_ms` and no `model_call_id`, to avoid double-appending), `tool_call` started/completed correlated by `call_id` (readToolCall, writeToolCall, generic function), terminal `result` (duration_ms, session_id). Thinking events are suppressed in print mode. — [Cursor output format](https://cursor.com/docs/cli/reference/output-format)
- Cursor states field additions are "backward-compatible" and consumers should ignore unknown fields; `duration_api_ms` currently equals `duration_ms`; the json result has no cost/token usage fields documented. — [Cursor output format](https://cursor.com/docs/cli/reference/output-format)
- Cursor CLI runs as an ACP server via `agent acp` (stdio JSON-RPC), supports agent/plan/ask modes, session resume, and extension methods `cursor/ask_question`, `cursor/create_plan`; team-level MCP servers configured in the dashboard are not supported in ACP mode; clients must answer permission requests or tool execution blocks. — [Cursor ACP](https://cursor.com/docs/cli/acp)

### Inferences
- Claude Code is the only CLI whose stream carries cost, retry/rate-limit categories and permission denials, which map directly to Plangineer's "plan limit reached" and run cost display. For Codex, cost must be derived from `turn.completed.usage`; for Cursor, no cost is available in the documented schema.
- Pin and record the CLI version per run, parse tolerantly (ignore unknown fields), and gate features on `system/init.capabilities` for Claude. A conformance test suite that runs each CLI against a recorded prompt in CI against the latest version would catch drift early.
- `--bare` cannot be used for the local-subscription path (no OAuth) and would also skip repo skills, so the runner should run plain `-p` with an explicit `--permission-mode` and `--allowedTools`, and must treat the repo's `.claude/settings.json` hooks and `.mcp.json` as code that executes (the repo is trusted by definition in this product, but fork PRs or untrusted repos on hosted runners are not).
- For stop/cancel: send SIGINT first (clean turn end), then SIGTERM, then kill the process tree after a timeout. On Windows, signals do not map directly; use job objects / `taskkill /T` or the SDK's `interrupt()`.

### Gaps
- I did not retrieve the exact full `claude --help` flag list (e.g. `--session-id`, `--max-turns`, `--mcp-config` details) or the Codex `--output-schema`/event schemas as machine-readable JSON; the doc summaries are model-condensed. Verify with `--help` and Codex `generate-json-schema`.
- Cursor flags for sandbox/approval (`--mode`, `--sandbox`, `--approve-mcps`, `--workspace`) were not documented in what I fetched.
- No formal semantic-versioning or deprecation guarantee for any of the three NDJSON formats was found, only Cursor's "additive fields" statement and Claude's `capabilities` mechanism. Codex deprecated `--full-auto`, showing flags do change.
- Skill folder behaviour for Codex (`.agents/skills`) and Cursor (`.cursor/skills`, `.agents/skills`) is taken from the MVP doc and a secondary source, not re-verified here; Cursor SDK says it auto-loads `.cursor/skills/` ([agentpatterns.ai](https://agentpatterns.ai/tools/cursor/cursor-sdk/)).

## 2. SDK vs shelling out to the CLI for subscription-login local use

### Takeaway
For the local runner, the vendor SDKs mostly wrap the same binaries, so the choice is about parsing convenience, not capability. Anthropic's terms allow an end user to sign in to the unmodified Claude Code with their own plan, but tell product developers to use API keys for the Agent SDK; this makes the CLI-as-subprocess path the cleanest compliance story for Claude. Codex has a first-class subprocess-embedding protocol (`app-server`) that is better than parsing `exec --json` for approvals and interrupts. Cursor SDK is API-key only.

### Cited Findings
- The Agent SDK "runs the Claude Code binary"; to use another language, run the CLI as subprocess with `-p --output-format json`. Skills, hooks, MCP, sessions, permissions and plugins are available in the SDK and load from `.claude/` like the CLI. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Anthropic: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods". — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Legal page: developers building products with the Agent SDK should use API keys; developers may not "collect, store, or intermediate Claude.ai credentials or session tokens"; this does not prevent an end user from signing in to the unmodified Claude Code binary with their own subscription, including where a platform hosts Claude Code. Hosting Claude Code in a product requires Commercial Terms, the binary must be unmodified and no auth method removed, and customers may not pay for or resell usage on end users' behalf. — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Help Center: "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits"; the planned move to a separate monthly credit (Pro $20, Max 5x $100, Max 20x $200, Team/Enterprise tiers) is paused; "The SDK supports Claude subscription authentication." — [Claude Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- Agent SDK branding: product may not be named or appear as "Claude Code"; "Claude Agent" or "Powered by Claude" allowed. Legal page: may say plainly that the product runs Claude Code, but not use the name/logo in the product or company name. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Legal](https://code.claude.com/docs/en/legal-and-compliance)
- Codex app-server is the interface used by Codex's own rich clients (VS Code extension), supports ChatGPT login account context, approvals and streamed events. — [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- Cursor SDK `@cursor/sdk`: public beta since 2026-04-29; local in-process, Cursor cloud VMs, or self-hosted workers; authenticates with `CURSOR_API_KEY` (user or service-account keys; Team Admin keys not supported); usage bills to consumption pricing sharing request pools with IDE and Cloud Agent. — [agentpatterns.ai](https://agentpatterns.ai/tools/cursor/cursor-sdk/) (secondary), [Cursor SDK coverage](https://www.buildfastwithai.com/blogs/cursor-sdk-coding-agents-typescript-2026)
- Open-Inspect drives the agent in-sandbox with either the OpenCode server or the Claude Agent SDK (API-key hosted use). — [background-agents repo](https://github.com/ColeMurray/background-agents)

### Inferences
- Local Claude path: either `claude -p --output-format stream-json` or the TypeScript Agent SDK launched in the engineer's process should both bill to the plan; the SDK adds typed messages, `canUseTool` callbacks and `interrupt()`. Because Plangineer is a product, the safest reading of the terms is: spawn the engineer's own installed `claude` binary (unmodified, own login) and never ship or bundle the SDK's own OAuth handling. If the SDK is used locally it should be pointed at the user's installed binary and never be given tokens. This is an interpretation, not a legal conclusion; the MVP already notes confirming hosted subscription use with Anthropic.
- Codex: prefer `codex app-server --listen stdio://` (generate TS types with `generate-ts` and commit them) over `codex exec --json` for the implementer role (gives approvals, interrupt, steer, resume). Keep `codex exec --json --output-schema` as the simple path for review/confirm roles that return structured findings.
- Cursor: keep CLI `agent -p --output-format stream-json` for local subscription login; do not use `@cursor/sdk` for the local path (API key only, beta).
- Plangineer's structured outputs (findings, plan JSON) should use `--json-schema` (Claude) and `--output-schema` (Codex) so the confirm/triage pipeline gets validated JSON; Cursor has no documented equivalent so validate and retry runner-side.

### Gaps
- Could not confirm whether the current Agent SDK package versions or the `@openai/codex-sdk` bypass or require `codex app-server` on Windows; only a secondary source.
- No authoritative statement found on whether a third-party product's local runner that merely spawns the user's `claude` counts as "third-party app usage" under plan limits; the Help Center lists "third-party apps authenticating via Agent SDK" as covered usage but not the spawn-the-CLI case.

## 3. Cross-agent protocols (ACP) and whether to use them vs one adapter per CLI

### Takeaway
ACP is real and now covers all three agents (Claude via adapter, Codex via adapter, Cursor natively), but it is designed for editor-to-agent interaction with local stdio subprocesses; remote transport is explicitly unfinished and the Claude and Codex adapters are wrappers over the same SDK/app-server you could call directly. Use ACP as a later optional adapter, not as the foundation. Define Plangineer's own normalized RunEvent type and write one thin adapter per CLI.

### Cited Findings
- ACP standardises editor-agent communication; local agents run as subprocesses over JSON-RPC on stdio; remote (HTTP/WebSocket) support is "a work in progress". — [ACP introduction](https://agentclientprotocol.com/overview/introduction)
- ACP registry (as fetched 2026-10-06): Claude Agent adapter v0.86.0 (`agentclientprotocol/claude-agent-acp`, npm), Codex adapter v2.1.1 (`agentclientprotocol/codex-acp`, npm), Cursor 2026.10.01 (built in, `agent acp`), Gemini CLI 0.63.0, OpenCode 1.18.35. — [ACP registry](https://agentclientprotocol.com/registry/index)
- `claude-agent-acp` is built on the official Claude Agent SDK; it supports tool calls with permission requests, diffs, TODOs, subagent transcripts, terminals, slash commands, client MCP servers; Apache 2.0, ~2.6k stars. Auth details not stated. — [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
- Cursor's ACP mode adds Cursor-specific blocking extension methods and lacks dashboard team MCP servers. — [Cursor ACP](https://cursor.com/docs/cli/acp)
- A third-party platform (OpenClaw) already drives Claude Code, Cursor, Codex, Gemini, OpenCode via ACP backends; the registry reportedly lists about 50 agents. — [OpenClaw ACP docs](https://docs.openclaw.ai/tools/acp-agents/) (secondary)

### Inferences
- ACP gives one session/permission/update vocabulary across agents, which is attractive for run events and permission relay, but: (a) Claude and Codex adapters add a Node layer over what Plangineer can call directly, (b) skills/AGENTS.md, cost/usage and rate-limit signals are not first-class in ACP as far as I found, (c) `--json-schema`/`--output-schema` structured outputs have no ACP equivalent found.
- Since Plangineer must define its own RunEvent schema anyway (feature tab, timeline, cost, skills loaded), ACP's value is reducing parse code. Reasonable plan: adapter interface `spawn(job) -> AsyncIterable<RunEvent>` with three native implementations first; add an ACP-based generic adapter later for Gemini/OpenCode/Copilot support at near-zero cost.
- Risk: adapter versions (claude-agent-acp 0.x) move fast and add a dependency whose auth behavior I could not confirm.

### Gaps
- Did not verify the ACP spec's session methods (`session/new`, `session/prompt`, `session/request_permission`) or how ACP expresses usage/cost; fetched summary lacked method names.
- No source on ACP stability guarantees (spec version numbering) or on running ACP agents under a hosted runner over the network.

## 4. Runner language, packaging, distribution and auto-update

### Takeaway
Recommended: TypeScript on Bun, compiled with `bun build --compile` into one executable per OS/arch, distributed via GitHub Releases plus a thin install script and signed installers, self-updating by download-verify-swap. Rationale: shared types with the TS control plane, and all three agent vendors ship TS/JS ecosystems; the runner is I/O-bound process supervision where Go's advantages are modest. Go is the best rejected alternative.

### Cited Findings
- Bun `--compile` bundles code and Bun runtime into a standalone binary; cross-compile `--target` supports Windows x64/ARM64, macOS x64/ARM64, Linux x64/ARM64 (glibc and musl); `--minify`, `--bytecode`, embedded assets via `with {type:"file"}`; macOS needs `codesign` with JIT entitlements to avoid Gatekeeper warnings (Bun v1.2.4+); Windows-specific options (icon, hide console) require a Windows machine; docs reference Bun v1.4.2. — [Bun executables](https://bun.com/docs/bundler/executables)
- Node.js SEA is still described as experimental, with developer experience "not yet on par with Deno or Bun"; the flow injects a blob with postject and requires re-signing on macOS and Windows. — [search summary, DEV Community](https://dev.to/googlecloud/building-standalone-executables-with-nodejs-29l1) (secondary)
- Open-Inspect and Open SWE are primarily TypeScript/JavaScript (Open-Inspect) and Python/TS (Open SWE) respectively. — [background-agents](https://github.com/ColeMurray/background-agents), [open-swe](https://github.com/langchain-ai/open-swe)

### Inferences
- Shared-types argument: if the control plane is TypeScript, a TS runner can import the same zod/TypeBox schemas for jobs and RunEvents, and the Claude Agent SDK, `@openai/codex-sdk`/generated app-server types and `@cursor/sdk` are all TS-first. A Go or Rust runner would need codegen from JSON Schema and cannot use the SDKs.
- Why Bun compile over Node SEA: Bun cross-compiles from one CI host, embeds assets, has bytecode option; SEA needs per-platform builds and postject. Risk: Bun compile binaries are large (tens of MB since they embed the runtime) and Bun is younger; if a Bun-specific bug appears, the same TS source runs under Node, which preserves an escape hatch. Pin the Bun version.
- Why not Go: best-in-class static binaries, small size, `os/exec` and cross-platform process handling are excellent, and self-update libraries are mature; but no type sharing, and re-implementing event parsing and schema validation. Rejected for MVP; reasonable if the runner later needs to be extremely small or hosted at massive scale.
- Why not Rust: highest build and iteration cost for an agent-delegated codebase with little performance need. Why not Electron/Tauri tray app: adds GUI surface; the product UI is the web app. A tray icon/service wrapper can be added later.
- Distribution plan (unsourced, standard practice): GitHub Releases with per-target binaries plus SHA256 and a signed manifest; `curl | sh` and PowerShell installer scripts; Windows MSI/winget and macOS notarised pkg/Homebrew tap later; install as per-user service (launchd, systemd --user, Windows Task Scheduler or Startup). Self-update: runner checks the control plane for the required version, downloads to a temp file, verifies signature/hash, drains running jobs, replaces itself (on Windows rename-the-running-exe then restart via a small updater stub), and reports installed CLI versions in its hello message. Control plane must keep a min-supported-protocol version so it can reject old runners.
- Windows code-signing cost and SmartScreen reputation are a real shipping task for a Windows-first dev (user is on Windows 11); budget for an EV or cloud-signing certificate.

### Gaps
- No sourced data on Bun compiled-binary size, Windows Defender/SmartScreen false-positive rates, or Bun-compile stability with child-process spawning and PTY on Windows. Spike this in week 1.
- No source reviewed on Go/Rust self-update libraries or on Claude Code's own native installer's update mechanism (a useful reference design, not fetched).

## 5. Transport to the control plane

### Takeaway
Use an outbound WebSocket (runner dials the control plane) carrying a small versioned JSON message protocol, with HTTP POST fallback and reconnect-with-resume; this is what Open-Inspect does. gRPC and SSE are rejected for the runner link.

### Cited Findings
- Open-Inspect sessions use WebSocket between control plane (Cloudflare Durable Objects, one per session, with SQLite and WebSocket hubs) and sandbox bridges; the bridge relays to the OpenCode server or Claude Agent SDK harness. — [background-agents](https://github.com/ColeMurray/background-agents), [summary](https://dailyaiworld.com/blogs/open-inspect-background-agents-guide-2026)
- Codex app-server's WebSocket transport is explicitly experimental, so WebSocket should be Plangineer's own link, not Codex's. — [Codex App Server](https://learn.chatgpt.com/docs/app-server)

### Inferences
- WebSocket: bidirectional (job push, cancel, approvals, pings), passes through corporate proxies on 443 in most cases, trivial in TS with shared schemas. Needs heartbeats, sequence numbers per run for resume after reconnect, and idempotent job acks (lease with visibility timeout, as a queue would).
- gRPC: bidirectional streaming is attractive, but gRPC over HTTP/2 is routinely broken by corporate proxies and gRPC-web is not bidirectional; codegen cost without benefit when the other side is TS. Rejected.
- SSE + HTTP POST: workable (SSE down for jobs and cancel, POST up for events) and the most proxy-friendly, and is a good fallback; two channels complicate ordering. Long-poll: simplest but latency/streaming overhead; keep as degraded fallback only.
- Events must be buffered locally (disk, bounded) and replayed after reconnect so a laptop sleeping mid-run does not lose the log; the run record should be reconstructable from the runner's local transcript.

### Gaps
- No source comparing proxy behavior of WebSocket vs gRPC in enterprise networks; this is standard knowledge, not verified in this session.
- Did not check Cloudflare Durable Objects or other hosting for the control plane (out of scope of the question set).

## 6. Git worktrees, process supervision and concurrency

### Takeaway
One worktree per feature per run under a runner-owned directory, created with `git worktree add` from a bare/shared object store, never inside the user's working copy. Supervise each agent as a child process group with timeouts, SIGINT-then-kill escalation, and a concurrency limiter keyed on vendor plan. Limited sourced material was gathered here.

### Cited Findings
- Claude Code: sessions are discoverable across a project's git worktrees and (v2.1.223+) by ID from any directory; deleting the working directory mid-session does not crash the run but shell commands fail. — [headless](https://code.claude.com/docs/en/headless)
- Claude Code SIGTERM kills the Bash process tree, exit code 143; SIGINT or SDK `interrupt()` ends the turn gracefully. — [headless](https://code.claude.com/docs/en/headless)
- `codex exec` requires a git repo unless `--skip-git-repo-check`, and `--sandbox workspace-write` confines writes to the workspace. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- Open-Inspect uses per-repo `.openinspect/setup.sh` and `start.sh` lifecycle scripts and snapshots after each prompt; Open SWE uses persistent per-thread sandboxes with setup scripts or snapshots. — [background-agents](https://github.com/ColeMurray/background-agents), [open-swe](https://github.com/langchain-ai/open-swe)

### Inferences (practice, unsourced in this session)
- Layout: `<runner-home>/repos/<repo-id>.git` (bare clone, fetched on demand) and `<runner-home>/work/<feature-id>/<run-id>` worktrees on a branch `plangineer/<feature>`; set `core.hooksPath` safely, keep `git worktree prune` and a janitor for abandoned worktrees, check disk quota, and refuse to touch the engineer's own checkout. Use `git worktree add --detach` for read-only tasks (explore, review) to avoid branch locks.
- Windows: keep paths short (long-path limit), enable `core.longpaths`, and exclude from antivirus scanning guidance; `node_modules` per worktree is expensive, so allow a per-repo setup command and optional shared package store (pnpm).
- Concurrency: per-vendor semaphore (default low, e.g. 2), global CPU/RAM cap, queue with priorities (interactive pre-planning above automatic review); on `rate_limit`/plan-limit events (Claude `system/api_retry` categories) pause that vendor's lane and report to control plane. Never auto-fall-back to API keys (MVP rule).
- Supervision: spawn with process group (POSIX `setsid`/Windows job object), heartbeat the run, idle-output timeout and wall-clock timeout, kill tree, always record exit code and last N stderr lines, and reap background processes the agent started (Claude kills bash bg tasks ~5 s after result).
- Treat repo-controlled config (hooks, `.mcp.json`) as code execution on the engineer's machine; show which MCP servers/hooks loaded (from `system/init`) in the run record.

### Gaps
- I did not fetch git-worktree documentation or any industry write-up on worktree-per-agent practice (e.g., parallel agents tools), so worktree specifics above are standard practice, not cited.
- No data found on Windows job-object handling for the three CLIs' child processes.

## 7. Hosted runners and sandboxing (GitHub Actions first, sandboxes later)

### Takeaway
Start with GitHub Actions: a workflow_dispatch job on a GitHub-hosted (or self-hosted) runner that runs the same runner binary in "one-shot job" mode, using API keys. Later move to an E2B/Daytona/Modal-style sandbox behind a `SandboxProvider` interface, as Open-Inspect does. Persistent-session vendors differ materially on idle behavior and snapshots.

### Cited Findings
- Vendor claims on isolation: E2B, Vercel and Fly.io use Firecracker microVMs; Modal uses gVisor; Daytona and Cloudflare are container-based (Daytona also offers VMs). — [Fly.io comparison](https://fly.io/learn/agent-sandbox-providers/) (Fly.io authored, biased toward Sprites)
- Persistence for a coding agent with a repo: Fly Sprites 100 GB disk and sleep/resume; Daytona stops after 15 idle min and archives after 7 days; E2B persists via pause (killed by default otherwise); Vercel 24 h session cap on Pro and 30-day snapshots; Modal 24 h max with memory snapshots expiring in 7 days; Cloudflare loses files and processes when the container stops. — [Fly.io comparison](https://fly.io/learn/agent-sandbox-providers/)
- Billing shape "rewards short bursts and punishes long, mostly idle sessions", which matters for agents waiting on model responses. — [Fly.io comparison](https://fly.io/learn/agent-sandbox-providers/)
- Other benchmark and comparison pages exist (Modal pricing from $0.000014/core/s; Cloudflare $0.000020/vCPU/s with $5/mo base plan) but are vendor or aggregator content. — [Superagent benchmark](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026), [Modal resources](https://modal.com/resources/best-code-execution-sandboxes-coding-agents)
- Open-Inspect (Ramp Inspect clone, single-tenant by design): control plane on Cloudflare Workers/Durable Objects + D1; data plane sandboxes on Modal, Daytona, E2B or OpenComputer providers; each sandbox runs a supervisor, an agent harness (OpenCode or Claude Agent SDK) and a bridge; snapshots after each prompt; repo `.openinspect/setup.sh`/`start.sh`; child sessions in separate sandboxes; shared `shared` types package; Node 24, Python 3.12, Bun, git, browser automation baked into the image. — [background-agents](https://github.com/ColeMurray/background-agents), [Open-Inspect guide](https://dailyaiworld.com/blogs/open-inspect-background-agents-guide-2026)
- Open SWE: built on LangChain Deep Agents and LangGraph; LangSmith default sandbox provider with other providers or local configurable; per-thread persistent Linux sandboxes; triggers from dashboard, GitHub, Slack, Linear; MIT; self-described as under active development with "breaking changes and rough edges"; Python backend. — [open-swe](https://github.com/langchain-ai/open-swe)
- Codex has an official GitHub Action (`openai/codex-action`); Claude Code has GitHub Actions and GitLab CI integration pages. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [headless next steps](https://code.claude.com/docs/en/headless)
- Anthropic: hosting Claude Code in sandboxes requires Commercial Terms, unmodified binary, and each end user authenticating with their own key/plan or 3P provider; no reselling. — [Legal](https://code.claude.com/docs/en/legal-and-compliance)
- Cursor SDK offers a self-hosted worker mode where Cursor cloud handles inference and your worker handles tool execution. — [agentpatterns.ai](https://agentpatterns.ai/tools/cursor/cursor-sdk/)

### Inferences
- GitHub Actions fits the MVP's "avoid building sandbox infrastructure": per-job ephemeral VM (fresh checkout, throw away), secrets store for scoped keys, native GitHub permissions, logs, `concurrency` groups; weaknesses: no durable session state, queue latency, 6 h job limit, minutes cost, and no interactive resume (mitigated by Claude `--resume` with persisted transcript uploaded as artifact, which the MVP's "runners hold no state" design avoids anyway). Plangineer runs here with `--permission-mode dontAsk`/explicit `--allowedTools` and API keys, never a stored subscription token.
- Phase 2+ sandbox pick: put a `SandboxProvider` interface (create from image/snapshot, exec, stream, snapshot, destroy) in front and start with E2B (Firecracker, pause/resume, JS SDK) or Daytona; Modal if you already need Python/GPU; Cloudflare Sandbox is unsuitable as a durable workspace per the Fly-sourced note (verify, vendor-biased). Do not build microVM infrastructure yourself.
- Reuse Open-Inspect's ideas, not its code, unless adopting it wholesale: its split (control-plane DO per session, thin in-sandbox bridge speaking WebSocket, supervisor, setup/start scripts, snapshot after each prompt) is the pattern the Plangineer runner should mirror, so the same runner binary can run locally or in a sandbox. Open-Inspect is single-tenant and TS, so it is a plausible starting base if the control plane is not already built; Open SWE is Python/LangGraph and would add a second language and a different agent loop (it does not drive Claude Code/Codex/Cursor CLIs), so reject it as a base.

### Gaps
- Sandbox pricing and cold-start numbers are from aggregator or vendor pages; no independent benchmark verified. The Superagent benchmark was only seen as a search snippet.
- Did not read the Open-Inspect wiki/docs in depth (runner bridge protocol message types, auth between bridge and control plane) nor the Open-Inspect license.
- GitHub Actions limits (job timeout, concurrency, runner minutes) were not fetched; figures above are from general knowledge and flagged as unverified.
- Did not examine other open-source background-agent projects beyond these two (e.g., OpenHands, Coder, Sweep).

## 8. Final recommendation summary (for the report writer)

### Takeaway
Primary stack: TypeScript runner compiled with Bun (fallback Node), outbound WebSocket to the control plane, one native adapter per CLI normalised to a Plangineer RunEvent schema, git worktrees per run, GitHub Actions as the first hosted runner and an E2B/Daytona-style provider later.

### Cited Findings
- Facts supporting each element are cited in sections 1 to 7 above.

### Inferences
- Claude adapter: spawn `claude -p --output-format stream-json --verbose --include-partial-messages --json-schema <...> --permission-mode <explicit> --allowedTools ...` (no `--bare` locally); feature-detect on `system/init.capabilities`; cancel via SIGINT then SIGTERM; parse `result.total_cost_usd`, `permission_denials`, `system/api_retry`. Optionally move to the TS Agent SDK pointed at the user's installed binary for approval callbacks, keeping the same adapter interface.
- Codex adapter: `codex app-server --listen stdio://` with generated TS types for the implementer; `codex exec --json --output-schema --sandbox workspace-write` for structured review roles; resume via thread/session ID.
- Cursor adapter: `agent -p --output-format stream-json --stream-partial-output --force` (writes allowed only inside the worktree), with tolerant parsing and runner-side JSON validation; consider `agent acp` once Plangineer needs approvals, interrupts and plan mode.
- ACP: defer; build the adapter interface so an ACP-backed adapter can be dropped in for other agents later.
- Rejected: Go (no type sharing; reconsider at scale), Rust (cost), Node SEA (experimental, per-platform signing), Electron/Tauri (UI not needed), gRPC (proxies, no benefit), SSE-only (fallback only), Open SWE as base (Python/LangGraph, own agent loop), building own sandbox infra, using vendor SDKs as the primary path for subscription login (Cursor SDK API-key only; Claude SDK terms).
- Spike list before committing: (1) Bun-compiled binary spawning `claude`, `codex`, `agent` on Windows, including cancel and process-tree kill; (2) code-signing and self-update swap on Windows; (3) a recorded-run conformance test per CLI; (4) Codex app-server vs `exec --json` on Windows; (5) confirm with Anthropic hosted-subscription terms.

### Gaps
- All recommendations that rely on practice rather than a citation are marked as inferences; legal interpretation of Anthropic's terms for a third-party runner is not settled here.

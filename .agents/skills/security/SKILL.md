---
name: security
description: Review a plan or diff for authentication and roles, object access, CSRF, runner pairing, webhook verification, untrusted agent output and repository content, prompt injection, command injection, path traversal, secrets in logs and vendor logins. Used by plan review and implementation review.
disable-model-invocation: true
---

# Security

Finds concrete security defects, in a plan or in a diff. It raises findings in the [finding format](../orchestrator-references/finding-format.md) with source skill `security`, as `defect` only. Read the [stack decisions](../../../docs/engineering/stack-decisions.md) first.

The area rules live in `auth-and-access` (sessions, roles, pairing, vendor logins), `github-integration` (webhooks, App tokens), `runner-adapters` (spawning) and `electron-desktop` (the app window, navigation and the local stack). This skill checks the trust boundaries across them and holds the rules no area skill owns. A breach of an area rule found here is still raised, citing that rule.

Plangineer is a desktop app, one deployment per install, with no tenancy. Users are admin or member. The control plane is `apps/api`, which the desktop app runs on `127.0.0.1` beside Postgres. A team server runs the same code later, so loopback is never a reason to skip a check. A runner on an engineer's machine executes agent CLIs, so it is the most dangerous component: injected text that reaches it can run code on a developer machine.

## Boundaries to check

| Boundary | Check |
| --- | --- |
| Sessions | Every procedure, SSE stream and upload that reads or changes data requires a session. A route with no check is a defect |
| Object access | Authorization checks the object, not just the role. An id from the client is looked up with the caller's access applied, so a member cannot read or change a run, plan, finding or evidence they should not by changing an id. Admin-only actions check the role in the procedure, not only in the UI |
| CSRF | Cookie-authenticated oRPC procedures reject cross-site requests: `SimpleCsrfProtectionHandlerPlugin` on the server with `SimpleCsrfProtectionLinkPlugin` on the client, or an equivalent `Origin` check. A state-changing `GET` is a defect |
| Runner channel | The WebSocket authenticates with the runner token in the handshake before any message is handled, and never accepts a browser session cookie. A runner receives only its own runs, and the API checks that each runner message refers to a run leased to that runner |
| Webhooks | Signature checked over the raw body before parsing, as `github-integration` sets. No other route accepts unauthenticated writes, except `runner.startLogin` and `runner.pollLogin`, which a global cap on pending login requests bounds, and `instance.githubAppManifest` and `instance.completeGithubApp`, which require the setup token and refuse once an App exists |
| GitHub tokens | Installation tokens are minted per use, kept in memory, and never logged, stored, put in plan text or sent to the browser. A runner gets one only for the run that needs it |
| Vendor logins | Check [the vendor login rule](../auth-and-access/SKILL.md#the-vendor-login-rule). Any breach is a `blocker` |
| Secrets | Secrets come from the validated environment, listed in `.env.example` with placeholder values, or from a row encrypted with `BETTER_AUTH_SECRET`, as the GitHub App is. They are never committed, bundled into `apps/web` (no secret behind a `VITE_` prefix) or returned from an API |
| Desktop window | Window settings, permissions and navigation follow `electron-desktop`. A breach is a defect |
| Storage | S3 evidence is served through a checked procedure or a short-lived presigned URL, never a public bucket. Keys are generated, never built from a user's file name |

## Untrusted input

Treat all of this as hostile: agent output, run events, repository content, plan and finding text, pull request text, webhook payloads, runner messages, file names and user input.

- **Parse at the boundary.** Runner messages and RunEvents are parsed with Zod schemas from `packages/contracts`, using `z.strictObject` and `.max` bounds. Plain `z.object` strips unknown keys silently instead of rejecting them. Webhook bodies are third-party, so they parse only the fields used, with `z.object`. Request bodies and WebSocket messages have a byte limit before parsing.
- **Prompt injection.** Repository files, issue text and agent output can carry instructions. They go into prompts as delimited data, never as instructions. Nothing an agent writes is a decision, approval or permission: an agent cannot approve its own plan, confirm its own finding or mark a deviation decided. The exceptions are sessions under engineer-set [workflow settings](../orchestrator-references/review-loop.md#workflow-settings): under `findings: fix_all` the author's `valid` or `invalid` verdict decides, so it fixes every valid finding, reverts each valid deviation or extra and keeps the invalid ones, and `decisions` set to `recommended` takes and records the recommended option.
- **Bounded agents.** The agent's own permissions limit what injected text can do. Claude Code runs with an explicit `--permission-mode` and `--allowedTools`, and Codex with `--sandbox workspace-write`. `--dangerously-skip-permissions`, `bypassPermissions` or `danger-full-access` is a `blocker`. The agent's `cwd` is its worktree.
- **Rendering.** Agent and repository text renders as text. Markdown rendering leaves raw HTML off, or sanitizes it with `rehype-sanitize`. No `dangerouslySetInnerHTML` with such text. Links from content allow only `http`, `https` and `mailto`.
- **Paths.** A path built from repository content, agent output or user input is resolved with `fs.realpath` and checked to stay inside the worktree or data directory, so `..`, absolute paths and symlinks an agent created cannot escape. Archive extraction rejects `..` and absolute entries.
- **SQL.** Drizzle parameters only. A raw `sql` template with a concatenated or `sql.raw` value from input is a `blocker`.

## Commands

- CLIs are spawned with execa, an argument array and no shell. `shell: true`, `exec`, or a command string built from input is a `blocker`.
- Untrusted text reaches a CLI on stdin or in a file, never as an argument. On Windows, npm-installed CLIs are `.cmd` shims that `cmd.exe` re-parses, and argument escaping there is unreliable.
- A ref, branch or path passed to `git` comes after `--end-of-options` or `--`, and a ref is checked with `git check-ref-format` first, so input cannot become a flag such as `--upload-pack`.
- The child gets an explicit, minimal environment. It never inherits server secrets or the runner token.
- Runs are bounded: a timeout, an output size limit and a stop that kills the whole process tree.

## Logs and errors

- pino `redact.paths` covers tokens, cookies, authorization headers, webhook secrets, device secrets, user codes, runner tokens, the setup token (`setupToken`), and the GitHub App's client secret (`client_secret`, `clientSecret`) and key (`pem`, `privateKey`). A whole request, webhook body or config object is never logged.
- Agent output and run events are stored as run data, not copied into server logs. They can hold secrets from a repository.
- Errors to the client carry a typed code and a safe message, never a stack, a SQL fragment, a path or a token.

## Plan review mode

Check the plan, not code. Use the same boundaries as questions the plan must answer.

- Does the plan add a trust boundary: a new route, procedure, webhook, runner message, file or network input, stored secret, role or spawned command? If so, does a step say how it is authenticated, authorized per object, validated and bounded?
- Does a "done when" line and the test plan cover the security behavior, for example a rejected bad signature, a member denied another user's object, an expired login request?
- Does any step design something that breaks a rule above, such as storing a vendor login, using a shell, widening agent permissions or trusting agent output as an approval?
- Is a decision left open on a security point?

| Severity | Examples |
| --- | --- |
| `blocker` | A new trust boundary with no step saying how it is authenticated, authorized and validated, a design that breaks a rule above, or a security decision left open |
| `should fix` | A designed boundary with no "done when" line or test plan row proving its security behavior, or a missing bound such as a rate limit, timeout or size limit |
| `nit` | Hardening that changes no real risk |

A plan that adds no boundary needs no security finding. Say nothing rather than adding filler.

## Implementation review mode

Check the diff. Trace hostile input from where it enters, through parsing, authorization, storage and use, to where it has an effect. A helper that exists but is never called is not a control. A new dependency in the API or runner, or one allowed to run install scripts, is checked for need and source.

Each finding gives the location, the path an attacker or a bad input takes, the consequence and the fix. Name what you did not verify, and do not present a gap as a pass.

| Severity | Examples |
| --- | --- |
| `blocker` | An unauthenticated or unauthorized write, an object read across users, an unverified webhook, a shell spawn, widened agent permissions, a stored or logged secret, a vendor login handled, injection |
| `should fix` | A missing bound, missing CSRF protection on a cookie route, a weak token comparison, an unescaped render with a limited effect, redaction that misses a field |
| `nit` | Hardening that changes no real risk |

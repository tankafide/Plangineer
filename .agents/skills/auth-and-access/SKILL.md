---
name: auth-and-access
description: Better Auth 1.x with GitHub sign-in and the Drizzle adapter, admin and member roles, and runner pairing with hashed tokens. The app never reads, stores or relays a vendor login. Implement and review modes.
disable-model-invocation: true
---

# Auth and access

Who may use the app and who may run work for it. One deployment serves one team, so there is no tenancy, no organization model and no SSO. Better Auth 1.x with the Drizzle adapter and GitHub sign-in handles engineers. Runners pair with their own tokens. Threat rules in general belong to `security`.

## The vendor login rule

This section is the one statement of the rule. Other skills link here.

The app never reads, stores or relays a vendor login. A vendor login is the credential a coding CLI uses to reach its provider: a Claude Code or Codex session, token, API key such as `ANTHROPIC_API_KEY`, or `auth.json`. The engineer signs in to those CLIs on their own machine, and the CLI uses what it has stored there.

- The control plane never holds a vendor credential. No field, table, column, log line, event payload, contract, control-plane environment variable or runner message carries one.
- The runner never opens a CLI's credential files, and never reads, logs, stores or sends a vendor credential's value.
- The runner starts the CLI with an explicit allowlist of variables from its own environment: what the CLI needs to run (such as `PATH`, the home and temp variables, locale and proxy settings) and the CLI's own documented configuration variables, which may include its API key. Those pass through by name, unread. The runner's own secrets, such as its token, never reach the child.
- Agent output that contains something shaped like a credential is treated as untrusted data, not forwarded as configuration.

## Implement mode

### Sign-in

- Better Auth with the Drizzle adapter (`provider: "pg"`) and the GitHub social provider. No other provider, no email and password, and no organization, SSO or admin plugin.
- Pass `secret` (32+ random characters) and `baseURL` from the parsed environment in `api-server`, and the GitHub client credentials from the stored GitHub App in `github-integration`, never letting Better Auth read `process.env`. With no App stored, GitHub sign-in is off.
- Mount the handler as `app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`, before any catch-all route. When the web app is on another origin, register `cors({ origin, credentials: true })` for `/api/auth/*` before the handler, with an explicit origin, never `*`.
- `trustedOrigins` lists only the web app's origin from the environment. Production never lists `localhost`. Never set `disableCSRFCheck` or `disableOriginCheck`.
- Keep Better Auth's cookie defaults (`httpOnly`, `SameSite=Lax`, `Secure` under `https`). Leave `session.cookieCache` off, so revocation and role changes apply on the next request.
- Resolve the session once, in the Hono middleware that builds oRPC context, with `auth.api.getSession({ headers: c.req.raw.headers })`.
- Set `advanced.database.generateId: "uuid"`. With `provider: "pg"` the adapter then leaves ids out of inserts, so the `uuidv7()` default from `data-model-design` applies. Never pass `forceAllowId`.
- Better Auth's CLI (`pnpm dlx auth generate`) writes its tables into the Drizzle schema, owned by `data-model-design`. Drizzle Kit owns migrations; never run Better Auth's `migrate`.
- Sign-in identifies the engineer only. Repository access goes through the GitHub App installation, owned by `github-integration`. Better Auth stores the user's non-expiring GitHub token in `account`, so set `account.encryptOAuthTokens: true` and never use, return or forward it.
- Request only the default scopes. Sign-in through the GitHub App's client needs its read-only Email addresses permission.
- Who may sign in, and how the first admin is made, are product decisions. Enforce them in `databaseHooks.user.create.before`. Build what the plan decides, and stop and ask if it decides nothing.

### Roles

| Role | May |
| --- | --- |
| `admin` | Everything a member may, plus configure repositories, orchestrators and automation levels |
| `member` | Everything else the plan grants members |

- The role is a `user.additionalFields` field with `input: false` and `defaultValue: "member"`. Without `input: false`, sign-up and update-user accept a client-sent role.
- Authorization is enforced on the server in oRPC middleware, as in `api-server`. The web app may hide a control, but hiding is never the check.
- A check names the permission it needs, such as `requireRole('admin')`, so a reviewer can read the rule at the call site.

### Runner pairing

The plan that adds pairing defines the exchange. It must keep these properties, shown here as one possible shape, a device authorization flow after RFC 8628:

1. The runner starts a login request on a public procedure and gets a device secret that only it holds and a user code. The request expires in minutes, belongs to no user yet, and is stored only as hashes.
2. A signed-in member approves the request in the browser, with the user code in the link. The request is then bound to the member who approves it.
3. The runner polls with its device secret. In one transaction, under a row lock, the API completes an approved request once and issues a runner token of at least 32 bytes from `crypto.randomBytes`, shown once.
4. The API stores only the token's SHA-256 hash under a unique index, with the runner id, the owning user, a label, and created, last-seen and revoked times. SHA-256 suffices for a random token.
5. The runner stores the token under its `env-paths` data directory and sends it in the WebSocket handshake's `Authorization` header. The API looks the token up by hash on every connection. Any direct comparison of raw secret values uses `crypto.timingSafeEqual`.
6. Revoking a runner sets its revoked time. The next handshake fails, and a live connection is closed.

- A runner token authorizes one runner for its owner's work only. It never grants a user session, and a user session never acts as a runner.
- Device secrets and tokens are never logged, put in a URL or returned a second time. The user code may appear in the approval link, since it grants nothing without a signed-in approval. None of the three is logged. Redact them in pino.
- The public login procedures are bounded by a global cap on pending login requests. The user code has 60 bits, so the member procedures need no per-user limit. Better Auth's limiter covers only its own routes.

### Tests

- Integration tests on real Postgres cover: each role on an admin procedure, a client-sent role ignored at sign-up, a revoked session refused on its next request, a login request polled twice, an expired login request, an approved login request polled after expiry, a revoked runner refused, and a token that does not match its hash.
- Better Auth's GitHub call is mocked with MSW.

## Review mode

Check a diff against these rules. Report each breach as a finding in the shared [finding format](../orchestrator-references/finding-format.md), with source skill `auth-and-access`.

| Rule | Severity if broken |
| --- | --- |
| Any breach of [the vendor login rule](#the-vendor-login-rule) | blocker |
| A device secret or token placed in a URL, or any of the device secret, user code and token stored in plaintext, logged, or returned more than once | blocker |
| A token generated with `Math.random` or a short length | blocker |
| A raw secret compared with `===` instead of `timingSafeEqual` | should fix |
| A role taken from client input, a role field without `input: false`, or authorization done only in the web app | blocker |
| A procedure that changes access with no role check | blocker |
| A login request that does not expire, completes twice, or issues a token before a signed-in member approves it | blocker |
| A revoked runner that can still connect, or a runner token accepted as a user session | blocker |
| `disableCSRFCheck` or `disableOriginCheck` set, or a wildcard or `localhost` trusted origin in production | blocker |
| The user's GitHub token stored unencrypted, used for repository calls, or sent to the browser or a runner | blocker |
| `session.cookieCache` enabled, or cookie defaults weakened | should fix |
| Better Auth's `migrate` used, or its tables kept outside the Drizzle schema | should fix |
| An organization, SSO or admin plugin, extra sign-in provider or tenant concept added | should fix |
| A role check that does not name the role | should fix |
| Auth behavior changed with no integration test | should fix |

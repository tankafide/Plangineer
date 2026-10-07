---
name: api-server
description: Hono 4 and oRPC 1.x routers in apps/api, handlers, middleware, Zod environment parsing at startup, pino logging, S3 evidence storage and typed errors. Implement and review modes.
disable-model-invocation: true
---

# API server

The control plane in `apps/api`: Hono 4, oRPC 1.x (not the 2.0 beta), Zod 4, pino and the AWS S3 SDK v3 on Node 24. Contract shapes and error maps belong to `api-contract-design`. Queries belong to `persistence`. Sign-in and roles belong to `auth-and-access`. Dispatch and realtime belong to `run-orchestration`.

## Implement mode

### Layers

| Layer | Holds | Rule |
| --- | --- | --- |
| Router | oRPC procedures implementing the contract from `packages/contracts` | Thin: input in, one service call, output out |
| Service | One business operation, owns the transaction | Calls `packages/domain` for logic and repositories for data |
| Repository | Drizzle queries | See `persistence` |
| Adapter | S3, GitHub, pino | One module per outside system, behind a small interface |

A router never imports a repository. Import rules are in `architecture-design`.

### oRPC on Hono

- Build procedures contract-first: `const os = implement(contract).$context<InitialContext>()`, and assemble the root with `os.router({...})` so the contract is enforced at runtime. Never declare `.input()` or `.output()` schemas on the server.
- Derive one `authed = os.use(authMiddleware)` base and build every procedure from it. A public procedure is built from `os` directly and named or commented as public.
- Apply a middleware at one level only, router or procedure, never both. Middleware that loads data stores it in context so a repeat run reuses it.
- Mount one `RPCHandler` from `@orpc/server/fetch` in a Hono `app.use('/rpc/*', ...)` with `prefix: '/rpc'`. Return `c.newResponse(response.body, response)` when `matched`, otherwise call `next()`.
- No Hono body-parsing middleware runs before the oRPC route. It consumes the request body and the handler then fails.
- Hono middleware builds the initial context (session from Better Auth, request id, child logger) and passes it to `handler.handle`. Handlers read context, never headers or cookies.
- Non-RPC routes (the SSE stream, the runner WebSocket upgrade, GitHub webhooks, the Better Auth handler) are Hono routes behind the same request-id and logging middleware.

### Errors

- Throw expected failures through the `errors` argument of the handler or middleware, such as `errors.NOT_FOUND()`, using codes the contract defines. Never throw a plain `Error` or an undefined `ORPCError` code for an expected case.
- `message` and `data` reach the client. Never put SQL, a stack, a path, a token or an internal id in them.
- oRPC turns any other thrown value into `INTERNAL_SERVER_ERROR`. Log it once in the `RPCHandler`'s `onError` interceptor and in Hono's `app.onError`, each with the request id.
- Never catch an error to return a default, an empty list or `null`. Catch only to rethrow as a typed error.
- Validate at the boundary only. Inside a service, values are already typed.

### Environment

- `apps/api` parses `process.env` once at startup with a Zod schema in a single module, and exits on any missing or invalid variable. The parsed object is passed to what needs it. Nothing else reads `process.env`.
- Every variable is in `.env.example`. Secrets have no defaults. Booleans and numbers are parsed explicitly, since `z.coerce.boolean()` reads `"false"` as `true`.

### Logging

- One root pino logger with `pino.transport({ targets })`: stdout and `pino/file` at `logs/api.log` with `mkdir: true`. Build the path with `node:path`.
- Each request gets `logger.child({ requestId })`. Log a stable message with structured fields, `log.info({ runId }, 'run claimed')`, never an interpolated string.
- Redact with pino's `redact.paths`: the `authorization` and `cookie` headers, `set-cookie`, tokens, secrets and S3 credentials. Paths match exact keys, not every depth, so log picked fields, never a whole request, webhook body or config object.
- On `SIGINT` and `SIGTERM`, stop accepting requests, close the server, then the database pool, then exit.

### S3 evidence storage

- One `S3Client` built from the environment schema: endpoint, bucket, region, credentials and `forcePathStyle` (true for MinIO).
- The server generates keys (a UUID under a feature and run prefix), never from user input. The database stores the key, not a URL.
- Runners upload with a presigned PUT from `@aws-sdk/s3-request-presigner`, issued after checking the run and the runner's pairing. Sign `ContentType` and `ContentLength`, with the length checked against the limit first, and set `expiresIn` in minutes. An unsigned length is not a limit.
- Browsers read through a presigned GET or a proxied response. Bucket and objects are never public.

### Tests

- Handlers and middleware are tested through the Hono app with `app.request()` against real Postgres, as in `persistence`. S3 and GitHub are mocked with MSW at the HTTP edge, so `pnpm verify` needs no MinIO. No real model call.

## Review mode

Check a diff against these rules. Report each breach as a finding in the shared [finding format](../orchestrator-references/finding-format.md), with source skill `api-server`.

| Rule | Severity if broken |
| --- | --- |
| A procedure not built from the authorized base and not marked public | blocker |
| A catch that returns a default or swallows the error | blocker |
| An error `message` or `data` that exposes a stack, SQL, a file path, a token or an internal message | blocker |
| A log call that can include a secret, a token, a cookie, a whole request or a full webhook body | blocker |
| An S3 key built from user input, a public bucket or object, or a presigned upload without signed content type and length | blocker |
| A server-side `.input()` or `.output()`, or a router not assembled through `implement(contract)` | should fix |
| A router that calls a repository, or business logic in a handler | should fix |
| A plain `Error` or undefined error code thrown for an expected failure | should fix |
| A body-parsing middleware before the oRPC route, or one middleware applied at both router and procedure level | should fix |
| `process.env` read outside the environment module, or a variable missing from `.env.example` | should fix |
| `console.log`, or an interpolated log message | should fix |
| A stored URL in place of an S3 key | should fix |
| A webhook, SSE or WebSocket route that bypasses the request-id and logging middleware | should fix |
| A change to a handler with no test through the Hono app | should fix |

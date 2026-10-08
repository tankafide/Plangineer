---
name: github-integration
description: The GitHub App and Octokit, installation tokens, webhook verification and handling for pushes, builds and merges, and opening pull requests. Use when planning, implementing or reviewing code that calls GitHub or receives its webhooks.
disable-model-invocation: true
---

# GitHub integration

How `apps/api` talks to GitHub. One GitHub App serves the whole deployment, with no per-organization setup. Sign-in is Better Auth and belongs to [auth-and-access](../auth-and-access/SKILL.md). Routes and middleware belong to [api-server](../api-server/SKILL.md). Pull request prose follows [writing-style](../writing-style/SKILL.md).

## Implement mode

### The App and Octokit

- The App id, private key and webhook secret come from the Zod-parsed environment and are listed in `.env.example`. The private key never appears in a log, an error or a response.
- GitHub issues PKCS#1 keys and Octokit's JWT signing needs PKCS#8. Convert once in the env schema with `node:crypto` `createPrivateKey(...).export({ type: 'pkcs8', format: 'pem' })`.
- Use the `octokit` package (`App`, with its built-in throttling and retry) and `@octokit/webhooks`. No hand-rolled REST, JWT or HMAC code, and no custom retry loops.
- All GitHub code sits in the GitHub adapter module, per the one-module-per-outside-system rule in [api-server](../api-server/SKILL.md). Handlers call it and never import Octokit.
- Store installations and repositories by numeric id, never by `owner/name`, which changes on rename or transfer.
- List endpoints go through `octokit.paginate`. Never read only the first page.
- Permissions: pull requests write, and contents, checks and metadata read. The runner pushes branches with the engineer's own credentials, so the App never writes code. Subscribe the App only to the events in the table below. Adding either is a plan decision.

### Installation tokens

- Mint an installation token per repository action, scoped with `repositoryIds` and the `permissions` the action needs. Octokit caches it; never store one in the database.
- Tokens expire after 1 hour. Never give a runner the App's private key or a credential that outlives its run. How a runner reaches a repository is decided by the plan, scoped to that run's repositories.

### Webhooks

1. One route receives all events. Read the raw body with `c.req.text()` before any JSON parsing.
2. Verify `X-Hub-Signature-256` with `webhooks.verify(rawBody, signature)`. A missing or bad signature gets 401 and does nothing else.
3. De-duplicate by `X-GitHub-Delivery`, which a redelivery keeps. A seen delivery gets 2xx and is not processed again.
4. Dispatch on `X-GitHub-Event` plus the payload's `action`. Parse the fields used with a Zod schema. Repository names, branch names and commit messages are untrusted text.
5. Record the delivery, then return 2xx. GitHub fails a delivery after 10 seconds and never retries it automatically, so slow work runs after the response, from the recorded row.

Handle only these events. Acknowledge and ignore everything else.

| Event | Effect |
| --- | --- |
| `push` to the default branch | Get changed files from the compare API for `before...after`, not the payload's `commits` array (capped at 2,048 and missing on oversized pushes). Pass them to `domain`'s staleness logic and raise a staleness warning for each overlap with an approved plan's files. Ignore `deleted: true` |
| `check_suite` completed | Record the result against the pull request's current head SHA, which gates the review stage. Every App's suites arrive. The build passes only when all suites for that SHA succeed. Ignore events for an older SHA, since deliveries arrive out of order |
| `pull_request` closed with `merged: true` | Mark the feature merged and its plan discarded after merge. A closed, unmerged pull request marks nothing merged |

### Opening pull requests

- One pull request per repository in a feature, from the feature branch.
- Before creating, look up an open pull request for `owner:branch`. If one exists, edit its body in place.
- The body is generated, never hand-typed, with the sections [writing-style](../writing-style/SKILL.md) lists. GitHub rejects a body over 65,536 characters; test the generator at that limit.
- A failed GitHub call surfaces its status and message. Never fall back to a different action.

### Tests

Use MSW for GitHub's REST API and fixture payloads signed with `webhooks.sign()`. Cover a valid, bad and missing signature, a replayed delivery, each handled event, a check suite for a stale SHA, an ignored event and a rate-limited response. Tests never call GitHub.

## Review mode

Raise findings with Source skill `github-integration`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| A webhook processed before its signature is verified, or verified against re-serialized JSON | blocker |
| The App key, webhook secret or an installation token is logged, stored or returned | blocker |
| A token wider than the repositories or permissions the action needs, or a credential given to a runner that outlives its run | blocker |
| Webhook fields used without Zod parsing, or branch and commit text used unescaped in a command or markup | blocker |
| Octokit imported outside the GitHub adapter module, or hand-rolled REST, JWT, HMAC or retry code | should fix |
| No delivery de-duplication, or slow work done before the 2xx | should fix |
| A build result taken from one suite, or from a SHA that is no longer the head | should fix |
| Changed files read from the push payload's `commits`, or a list endpoint read without pagination | should fix |
| A repository or installation stored by name instead of id | should fix |
| An unhandled event that does work instead of being ignored | should fix |
| A pull request body missing a section writing-style lists, or over 65,536 characters | should fix |
| A second pull request opened for a branch that has one | should fix |
| A test that calls GitHub, or a handler with no signature test | should fix |

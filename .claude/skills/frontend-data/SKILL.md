---
name: frontend-data
description: The typed oRPC client and TanStack Query hooks in packages/api-client, query keys, invalidation, retries, the fetch-based SSE reader that resumes by event id, and optimistic updates.
disable-model-invocation: true
---

# Frontend data

Rules for `packages/api-client`, the only place the web app talks to the API. Components use its hooks and never see oRPC or a query key. Screens and their states belong to [frontend-react](../frontend-react/SKILL.md), and the server side of the stream to [run-orchestration](../run-orchestration/SKILL.md).

## Implement mode

### Client and hooks

- Build one client from the `contracts` router with `RPCLink`, and wrap it once with `createTanstackQueryUtils` from `@orpc/tanstack-query`. Never hand-write a request or response type.
- Add `ResponseValidationPlugin` from `@orpc/contract/plugins` with the contract, so every response is parsed on the client. A parse failure is an error the UI shows as failed, never data.
- Export one hook per procedure, named for what it returns or does (`useFeature`, `useFeatureList`), built on the utils' `queryOptions`, `infiniteOptions` or `mutationOptions`.
- Disable a query whose input is not ready with `skipToken` as the input, not `enabled: false`.
- Branch on errors with `isDefinedError(error)` and `error.code`, never on a message string.

### Query keys

- Take every key from the oRPC utils: `.queryKey({ input })` for one query, `.key()` or `.key({ input })` for a partial match. Never write a key array by hand or keep a separate key factory.
- Every input that shapes a result (ids, filters, sort, page) goes in the procedure input, so it is in the key.
- Set `staleTime` per resource. Plan revisions are immutable, so they use `Infinity`. Live run state comes from SSE, never from polling.
- Set retry once in the `QueryClient` defaults: queries retry network failures and 5xx responses at most twice. Never retry a 4xx, a defined error or a mutation.

### Mutations and invalidation

- A mutation hook invalidates the narrowest partial keys its result changes, including derived views such as a list or a parent detail.
- When the response already holds what the screen shows, write it with `setQueryData`. Otherwise invalidate.
- Await the invalidation in `onSuccess` or `onSettled`, so the mutation stays pending until fresh data arrives.

### Optimistic updates

Only for clicks that must feel instant: triage choices, step reorder and tick boxes. Never for starting a run, opening a pull request or anything with effects outside the database.

1. In `onMutate`, `await cancelQueries` for the key, snapshot the cache, write the expected state with an immutable updater and return the snapshot.
2. In `onError`, restore the snapshot and show the failure on the item.
3. In `onSettled`, invalidate the key so the server's answer wins. Give the mutation a `mutationKey`, and skip the invalidation while `isMutating({ mutationKey })` is above 1, so rapid clicks do not flicker back.

### Live runs over SSE

Read the stream with `fetch` and `EventSourceParserStream` from `eventsource-parser/stream`, never `EventSource`, so the hook controls status codes, `Last-Event-ID` and reconnects. Never split the body by hand: SSE allows CR, LF and CRLF line endings.

- One hook per stream, `useRunEvents(runId)`. It aborts its request with an `AbortController` on unmount. No component opens a stream itself.
- Keep applied events in the query cache under the stream's key, so a remount resumes from the last stored id instead of starting over.
- Send `Last-Event-ID` on every request, including the first after a remount. Never refetch the whole log to recover.
- Apply events with an idempotent reducer keyed by event id. An event at or below the last applied id is ignored.
- Parse each event with the `RunEvent` schema from `contracts`. An event that fails to parse becomes a stream error and is never skipped.
- On a network drop or a stream that ends without a terminal event, reconnect with capped exponential backoff and jitter, and at once when the page becomes visible again. On a 4xx, stop and report `failed`.
- Expose a status: `connecting`, `live`, `reconnecting`, `ended` or `failed`. The UI treats `reconnecting` as stale, never as complete.
- A terminal event aborts the request, sets `ended` and invalidates the run's detail key.

### Tests

Test hooks with MSW and a fresh `QueryClient` per test with retries off. Cover the key each hook uses, invalidation after each mutation, rollback of a failed optimistic update, and SSE resume: drop the stream after event 5, then assert the reconnect sends `Last-Event-ID: 5` and no event is applied twice. Also cover a stream split mid-event across chunks and CRLF line endings.

## Review mode

Raise findings with Source skill `frontend-data`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| A transport type is hand-written, or a response is cast instead of validated | should fix |
| A hand-written query key, or an input that shapes the result left out of the key | should fix |
| A mutation invalidates nothing, or everything | should fix |
| An optimistic update with no cancel or rollback, or on a side-effecting action | blocker |
| A stream opened outside `api-client`, never aborted, or without resume by last event id | blocker |
| An SSE event applied twice, a hand-split SSE body, or a stream recovered by refetching the log | should fix |
| A stream that reconnects on a 4xx or after a terminal event, or with no backoff | should fix |
| Polling for data the SSE stream already delivers | should fix |
| Retries on a 4xx, a defined error or a mutation | should fix |
| The UI branches on an error message string | should fix |
| A hook with no test for its keys, invalidation or failure path | should fix |

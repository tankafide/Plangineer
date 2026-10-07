---
name: frontend-react
description: React 19 components and TanStack Router routes in apps/web, with explicit loading, empty, failed and stale states, plus forms, drag and drop, the editor and diffs.
disable-model-invocation: true
---

# Frontend React

Rules for `apps/web`, the React SPA. Components own presentation and interaction. Remote state belongs to [frontend-data](../frontend-data/SKILL.md), and layout and components to [ui-design-system](../ui-design-system/SKILL.md). Imports follow [architecture-design](../architecture-design/SKILL.md).

## Implement mode

### Structure

| Concern | Rule |
| --- | --- |
| Components | One component per file, kebab-case filename, named export. Feature code sits in `src/features/<feature>/`, shared primitives in `src/components/` |
| Data | Components call hooks from `packages/api-client`. They never build query keys, call `fetch` or import oRPC |
| Logic | Triage, staleness, amendment level and deviation matching come from `packages/domain`. A component never re-implements them |
| Effects | Derive values during render. Reset state on an identity change with `key`, not an effect. Use `useEffect` only to sync with something outside React, and `useEffectEvent` for non-reactive logic inside it. Never fetch in an effect |
| State | Keep state in the URL when a reload or a shared link should restore it: filters, selected finding, open tab. Use local state otherwise. No global store |
| React 19 | Pass `ref` as a prop. No `forwardRef` and no `Context.Provider` wrapper; render `<Context>` directly |

### Routes

- TanStack Router in SPA mode, never TanStack Start. Routes are file-based under `src/routes/`, with `autoCodeSplitting` on in the Vite plugin.
- `routeTree.gen.ts` is generated. Never edit it by hand.
- Register the router type once with `declare module '@tanstack/react-router'`, so every `Link`, `navigate` and hook is typed.
- Pass the Zod 4 schema straight to `validateSearch`, with no adapter. Give optional params `.catch()` values so an old or hand-edited link still renders.
- Navigate with `Link` or `useNavigate` using `to`, `params` and `search: (prev) => ...`. Never build a URL string.
- Read params with `Route.useParams()` and `Route.useSearch()`, or pass `from` to the bare hooks. Never read them untyped.
- Do not export `component` or other route options from a route file. An export pulls it out of its split chunk.
- The root route sets `notFoundComponent` and `errorComponent`. An unknown id shows not found, never a blank screen.

### Every remote view has five states

Each screen or card that reads remote data renders all five, and a test covers each.

| State | Rule |
| --- | --- |
| Loading | A skeleton shaped like the content, on the first load only. Never a blank area, and never a spinner over content already on screen |
| Empty | Says what is missing and offers the next action as a button, such as "No findings yet" with Start review |
| Failed | Shows the error and a Retry button. Never swallows the error or shows an empty state in its place |
| Stale | Content stays visible and is marked stale when a refetch fails, a live stream is reconnecting, or the plan changed under a finding or test row |
| Ready | The data, with a pending mutation shown on the item it changes |

Do not flash an empty state while loading. Keep selected filters and scroll position while a refetch runs.

### Forms, drag and drop, editor and diffs

- **React Hook Form** with `zodResolver` and the Zod schema from `contracts`, so one schema validates the form and the API call. Type the form as `useForm<z.input<typeof S>, unknown, z.output<typeof S>>` when the schema has defaults or transforms. Put a typed server validation error on its field with `setError`. A field error sits next to its field and is linked with `aria-describedby`.
- **dnd-kit** reorders plan step cards. Use the pointer, touch and keyboard sensors, with `sortableKeyboardCoordinates` for the keyboard. Give every card Move up and Move down buttons, since drag alone fails on a phone. Persist the new order in one mutation that rolls back on failure.
- **CodeMirror 6** edits plan and context file text. One wrapper component creates the `EditorView` once in a ref and destroys it on unmount. Push outside value changes in with a transaction, and change options through a `Compartment`. Never recreate the view on a prop change.
- **Diffs** come from `createTwoFilesPatch` in `diff`, parsed with `parseDiff` and rendered by `react-diff-view`. Compute a diff once per pair of revisions and memoize it. Render unified on a phone and split on desktop.

### Accessibility and safety

- Use `button` for actions and `a` (through `Link`) for navigation. Never put `onClick` on a `div`. Every input has a label.
- Every control works by keyboard and shows a visible focus ring.
- Render agent output, repository content and plan text as text. Use `dangerouslySetInnerHTML` only with sanitized markup.
- Lists that can grow are paginated or virtualized, never rendered whole.

### Tests

Component tests follow [testing](../testing/SKILL.md), query by role and label, and assert each of the five states. Journeys across screens are Playwright Test journeys.

## Review mode

Check the diff against these rules. Raise each break as a finding with Source skill `frontend-react`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| A component calls `fetch`, imports oRPC or builds a query key | should fix |
| `apps/web` imports from `apps/api`, `apps/runner` or the database layer | blocker |
| TanStack Start or a global state library is added | blocker |
| A remote view lacks a loading, empty, failed or stale state, or shows empty while loading | should fix |
| A failed request is caught and dropped, or replaced by an empty state | blocker |
| Fetching in `useEffect`, an effect that resets or derives state, or state that duplicates server data or a prop | should fix |
| Logic that `packages/domain` owns is rewritten in a component | should fix |
| Search params read without `validateSearch`, or a URL built as a string | should fix |
| `routeTree.gen.ts` edited by hand, or a route file exports its component | should fix |
| A form validates with its own rules instead of the `contracts` schema | should fix |
| A drag action has no button alternative | should fix |
| `onClick` on a non-interactive element, or an unlabeled input | should fix |
| Unsanitized HTML from agent, repository or plan content | blocker |
| An editor or diff view created during render, recreated on a prop change, or never destroyed | should fix |
| `forwardRef` in new code | nit |
| A new view with no component test for its states | should fix |

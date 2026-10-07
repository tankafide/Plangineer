# Plangineer web frontend stack (as of Oct 2026)

Scope note: research was capped at ~15 tool calls. Several sub-areas (Svelte/Vue agent quality, Zustand, markdown renderers, diff libs beyond npm listings) have thin or no sourcing and are listed under Gaps. Library recommendations that are not backed by a cited finding are labelled as inferences/opinion.

## 1. Framework and rendering model (React + Vite SPA vs Next.js vs TanStack Start vs others; is SSR needed?)

### Takeaway
Primary recommendation: React 19 + TypeScript + Vite 8 as a client-rendered SPA, with TanStack Router (file-based, type-safe) for routing. Plangineer is an authenticated, highly interactive app with no SEO surface, so SSR buys nothing. TanStack Start was still labelled Release Candidate in mid-2026 per secondary sources (conflicting evidence on whether it has since gone 1.0), so adopt only the Router now and keep Start as a later opt-in. Rejected: Next.js (SSR/caching complexity not needed, most controversial in State of JS), SvelteKit/Vue/Solid (smaller training data, poorer fit for later React Native reuse).

### Cited Findings
- React is still the most-used front-end framework at 83.6% in State of JS 2025; the ecosystem has "stabilized". Next.js is at 59% usage and drew the most polarized commentary (complexity, Vercel commercialization). Solid has top satisfaction but ~10% usage. — [InfoQ on State of JS 2025](https://www.infoq.com/news/2026/03/state-of-js-survey-2025); [Strapi summary](https://strapi.io/blog/state-of-javascript-2025-key-takeaways)
- Astro leads meta-framework satisfaction by 39 points over Next.js (content-site oriented, not relevant to an authenticated app). — [Strapi summary](https://strapi.io/blog/state-of-javascript-2025-key-takeaways)
- Exclusive TypeScript use rose to 40% (from 34%); plain JS is 6%. — [InfoQ](https://www.infoq.com/news/2026/03/state-of-js-survey-2025)
- Vite is at 98% satisfaction vs Webpack 26%; Rolldown adoption rose from 1% to 10%. — [InfoQ](https://www.infoq.com/news/2026/03/state-of-js-survey-2025)
- Vite 8 shipped 12 March 2026 with Rolldown (Rust) as the single bundler, with most existing Vite plugins working unchanged. — [Vite 8 announcement](https://vite.dev/blog/announcing-vite8); [AlternativeTo](https://alternativeto.net/news/2026/3/vite-8-debuts-with-unified-and-faster-rolldown-bundler-integrated-devtools-and-wasm-ssr/)
- React 19.2 released 1 Oct 2025 (no breaking changes vs 19.0). Next.js 16 released 21 Oct 2025 (Turbopack default, "use cache" Cache Components, proxy.ts replacing middleware.ts, with breaking changes). — [search summary of release notes](https://www.luckymedia.dev/blog/nextjs-16-an-early-look-and-release-date)
- TanStack Start v1 Release Candidate announced 23 Sep 2025; RSC support planned as a non-breaking v1.x addition. — [TanStack blog](https://tanstack.com/blog/announcing-tanstack-start-v1)
- As of mid-2026, secondary sources still describe Start as "Release Candidate", ecosystem smaller than Next.js, weak static prerendering, maintainer concentration risk; they recommend it for auth-gated dashboards where SSR is not needed. — [BuildMVPFast](https://www.buildmvpfast.com/blog/tanstack-start-vs-nextjs-spa-mvp-framework-2026); [Makerkit](https://makerkit.dev/blog/tutorials/what-is-tanstack-start)
- GitHub releases page shows @tanstack/react-start 1.168.60 and @tanstack/react-router 1.170.41 on 30 Sep 2026: very active cadence, but the fetched page did not state whether Start is formally "stable" (the version numbers are in the 1.x line). — [TanStack/router releases](https://github.com/TanStack/router/releases) (result summarized by fetch tool; status label unverified; the BuildMVPFast/Makerkit "RC" claims are mid-2026 and conflict with the 1.x numbering in a way I could not resolve)
- Open-source Claude Code web UIs in the wild use React + Vite + Tailwind (+ CodeMirror), i.e. the same shape as Plangineer. — [CloudCLI/claudecodeui mirror](https://gitcode.com/GitHub_Trending/cl/claudecodeui)
- Addy Osmani: AI success on Next.js framework-specific tasks was ~42% and ~25% on multi-step full-stack integrations, vs good results on isolated component work; a React+TS+Tailwind+shadcn monoculture gives the best AI assistance. — [Addy Osmani](https://addyosmani.com/blog/how-good-is-ai-at-coding-react-really/)

### Inferences
- No SEO, no public pages, and runs stream from a separate control plane API: SSR/RSC adds server-runtime coupling and a second place where code can run, which AI agents handle worse (the ~42% Next.js-specific figure supports this, though it is one benchmark cited in a blog).
- The control plane is the only backend; a pure static SPA (CDN-hosted) keeps one API for web and the future mobile app, which matches the MVP doc's "web app is one client of the API".
- TanStack Router's end-to-end type safety (route params, search params, loaders) gives agents compiler feedback, which matters more than framework popularity for delegated development. Router alone is unaffected by Start's status.
- Reasonable fallback if TanStack Router proves awkward for agents: React Router v7 in library/SPA mode (not researched; see Gaps).

### Gaps
- Could not confirm whether TanStack Start formally reached 1.0 by Oct 2026; sources conflict/are stale. Re-check npm/GitHub before relying on it.
- No direct data on SvelteKit/Vue AI-agent code quality beyond the general "mainstream stack = higher AI ceiling" claim; no State of JS numbers for Svelte/Vue retrieved.
- React Router v7 status and Next.js 16.x current version (Oct 2026) not verified.

## 2. Component and styling stack (Tailwind, shadcn/ui, Radix/Base UI) for AI-generated, mobile-responsive UI

### Takeaway
Tailwind CSS v4 + shadcn/ui (copy-in components, now with Base UI primitives available/default) is the AI-agent default stack and is the clear pick. Mobile-first utility classes map directly to the "one column first" requirement.

### Cited Findings
- Most AI tools converge on React + TypeScript + Tailwind + shadcn/ui; v0, Bolt, Lovable and Claude Code default to its patterns; code is copied into the repo so agents can read and edit it. — [React AI stack 2026](https://builder-proxy.humanx.co/blog/react-ai-stack-2026); [Addy Osmani](https://addyosmani.com/blog/how-good-is-ai-at-coding-react-really/)
- Tailwind v4 is a build-time, zero-runtime engine. — [UXMagic](https://uxmagic.ai/blog/best-react-ui-component-libraries)
- Base UI (ex-Radix engineers at MUI) hit v1.0 stable in Dec 2025. Radix updates slowed after WorkOS acquired it (delayed React 19 support, combobox gaps) though it still has ~130M monthly npm downloads. shadcn/ui ~75k+ GitHub stars (Mar 2026). — [PkgPulse comparison](https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026); [UXMagic](https://uxmagic.ai/blog/best-react-ui-component-libraries)
- Date conflict on shadcn's Base UI move: PkgPulse says shadcn "officially supports" Base UI from Feb 2026 (`shadcn init --base-ui`); UXMagic says it became the official default for new projects on 3 Jul 2026. Both agree Base UI is supported and now preferred. — [PkgPulse](https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026); [UXMagic](https://uxmagic.ai/blog/best-react-ui-component-libraries)
- AI "has mastered logic but not taste": spacing and hierarchy need human/design-token constraints. — [Addy Osmani](https://addyosmani.com/blog/how-good-is-ai-at-coding-react-really/)

### Inferences
- Init shadcn with Base UI (current default) for new work; avoid mixing Radix and Base UI in one codebase.
- Needed mobile primitives: shadcn Drawer (vaul) / Sheet for the "findings rise from a bottom sheet" pattern, Tabs, Accordion/Collapsible for step cards, Command for feature switching. All are in shadcn's catalog (general knowledge; not separately sourced).
- Encode design tokens (spacing scale, card variants, a `DecisionCard` component) and a written UI rule skill in the repo to counter the "no taste" weakness; Plangineer's own methodology (rule skills) fits this.
- Rejected: MUI/Ant/Chakra (heavier, runtime CSS or large theming surface, weaker fit for owned-code agent editing); CSS-in-JS and CSS Modules (less agent convergence, no RN reuse path).

### Gaps
- No primary-source verification of shadcn's release notes (dates above come from two secondary blogs that disagree).

## 3. Data fetching, forms, drag-reorder, diff, markdown/rich text

### Takeaway
TanStack Query (server state) + Zustand or URL state (small UI state) + React Hook Form with Zod + dnd-kit for card reorder + react-diff-view or a section-level diff built on `diff` + Tiptap (or CodeMirror 6 for raw context-file editing) + react-markdown.

### Cited Findings
- TanStack Query v5.90+ is the de facto standard for server state in React and is actively maintained through 2025-2026. — [OpenReplay](https://blog.openreplay.com/react-app-libraries/); [React AI stack](https://builder-proxy.humanx.co/blog/react-ai-stack-2026)
- React Hook Form: ~12M weekly downloads, default for new React projects; Zod schemas can serve as client validation, server validation and type source. TanStack Form has stronger TS inference; recommended for deeply nested dynamic forms. — [PkgPulse forms](https://www.pkgpulse.com/guides/best-react-form-libraries-2026); [LogRocket](https://blog.logrocket.com/tanstack-form-vs-react-hook-form/)
- dnd-kit is described as the 2026 default for React drag-and-drop: ~6KB core, accessible, pointer events for touch; Atlassian's Pragmatic drag-and-drop is the performance-focused alternative (<4KB). — [PkgPulse DnD](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026)
- @dnd-kit/react (new rewrite) was at 0.x (0.1.2 seen on npm listing; changelog shows 0.4.0 with breaking event API changes), i.e. not yet 1.0; the classic @dnd-kit/core + @dnd-kit/sortable remain the stable path. — [npm @dnd-kit/react](https://npmjs.com/package/@dnd-kit/react); [dndkit changelog](https://dndkit.com/changelog)
- react-diff-view consumes git unified diffs, supports split/unified, widget architecture for inline comments (suits inline findings), last updated 2026-03-30; react-diff-viewer last pushed Mar 2024 (stale). — [npm react-diff-view](https://npmjs.com/package/react-diff-view); [react-diff-viewer repo](https://github.com/chunxei/react-diff-viewer)
- Tiptap (ProseMirror-based, headless) is the suggested default for new React apps' rich text; comments/collab/AI extensions are paid (from $149/mo); Lexical is stronger for high-scale and React Native editor surfaces. — [PkgPulse editors](https://www.pkgpulse.com/guides/tiptap-vs-lexical-vs-slate-vs-quill-rich-text-editor-2026); [Velt](https://velt.dev/blog/best-rich-text-editors-react-comparison)

### Inferences
- The plan is structured data (sections, step cards, grid), not a freeform document. Store it as typed JSON and render with plain components; use rich text only inside leaf fields (step description, "done when", decisions). Tiptap in minimal markdown mode, or even a textarea with markdown preview, suffices. Do not build the plan editor as one big Tiptap/Lexical document.
- Revision diffs are structured: diff per field/section and per card (added/removed/moved steps), using `diff` (jsdiff) word-level for text fields, with a custom card-level diff UI. Reserve react-diff-view for the implementation-review code diffs and plan-audit views, where unified diffs and inline-comment widgets are native.
- Context files and skill files edit well in CodeMirror 6 (also used by open-source Claude Code UIs) or Tiptap; pick one, not both. Opinion: CodeMirror for raw markdown, since context files are agent-written markdown and users edit rarely.
- For the coverage grid, plain shadcn Table + Checkbox; TanStack Table not needed unless sorting/filtering grows.
- dnd-kit classic is the safest for agents (largest training exposure); must add explicit "move up/down" buttons, which the MVP requires anyway ("nothing depends on hover"; every action has a button) and which also covers accessibility.
- RHF vs TanStack Form: RHF for the intake form and settings (simple); question cards are not forms (button choices).

### Gaps
- No sources found for markdown rendering library comparison (react-markdown / streamdown / shiki) or for Zustand vs Jotai.
- Did not verify current stable dnd-kit core version or maintenance cadence (the "actively maintained" claim is from a secondary blog).
- Did not evaluate newer diff libraries (e.g. Pierre's diffs, @git-diff-view) beyond what the search surfaced.

## 4. Real-time streaming on the client (SSE vs WebSocket)

### Takeaway
SSE over HTTP for run timelines and notifications; use ordinary HTTP POST for commands. Use a fetch-based SSE client (needs Authorization headers) with event ids and resume-from-last-id, feeding events into the TanStack Query cache. WebSocket only if the control plane later needs bidirectional low-latency channels (the runner link, not the browser).

### Cited Findings
- SSE is unidirectional, works through standard HTTP proxies, has native auto-reconnect; the browser sends `Last-Event-ID` on reconnect so the server can replay missed events; events have `id`, `event`, `data`, `retry` fields. — [WebSocket.org comparison](https://websocket.org/comparisons/sse/); [Svix glossary](https://www.svix.com/resources/glossary/server-sent-events/)
- Native EventSource cannot set custom headers or use POST; use fetch streaming in that case. HTTP/1.1 has a ~6 connection-per-domain limit; HTTP/2 lifts it. — [search summary of SSE guides](https://openskillindex.com/skills/agents-inc-skills-web-realtime-sse-6b1a73); [Besthub on SSE in the LLM era](https://www.besthub.dev/articles/why-you-should-ditch-websocket-for-one-way-streams-sse-in-the-llm-era-ae19f7df7753)

### Inferences
- Timeline, finding, and notification feeds are server-to-client; user actions are REST calls. SSE fits, is simplest to proxy, and is replayable from the persisted run event log (the MVP stores an event log per run), so reconnect = "resume from event id N".
- Use `@microsoft/fetch-event-source` or a small custom fetch+ReadableStream reader (agents write this reliably) so bearer tokens work; alternatively cookie auth with native EventSource. Serve over HTTP/2. Mobile apps (React Native) lack native EventSource, so a fetch/XHR-based reader is also the cross-platform choice (RN streaming support not verified).
- Apply events with `queryClient.setQueryData` or invalidate on coarse events; keep high-frequency token streams in a ref/store and batch renders (requestAnimationFrame) to avoid re-render storms in long timelines; virtualize long timelines (e.g. TanStack Virtual).
- Foreground only: a backgrounded phone browser drops the stream, so rely on resume-by-id plus push notifications for decisions (matches MVP "work never depends on an open tab").

### Gaps
- No source specifically comparing client libraries (fetch-event-source maintenance status is unverified; it has been rarely updated historically, so a thin in-house wrapper may be safer).
- RN streaming-fetch support in Expo (SDK 56/57) not verified.

## 5. Path to a mobile app (PWA vs Expo/React Native vs Capacitor; code sharing)

### Takeaway
Phase 1: responsive installable PWA (same SPA). Later: Expo (React Native) with a shared TypeScript package for API client, types/Zod schemas, query hooks and business logic; UI rebuilt natively (React Native Reusables/NativeWind mirrors shadcn). Capacitor is the cheaper alternative if screens are near-identical and the team wants zero UI rewrite, but WebView push on iOS is the weak point.

### Cited Findings
- iOS web push only works for Home Screen-installed PWAs (iOS 16.4+), needs manual permission flow, no silent push or background sync, lower opt-in than native. Recommendation seen in sources: PWA first, Expo if push/background limits bite. — [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide); [WebScraft](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye)
- Capacitor wraps the existing web build; web push inside a WKWebView is unreliable on iOS, so native APNs via the Capacitor push plugin is the dependable route. Capacitor 8.5 is current (iOS 27 UIScene prep; Capacitor 9 expected). Ionic Appflow shuts down 31 Dec 2027 (live-update alternatives: Capgo, Capawesome, EAS Update, etc.). — [VP0](https://vp0.com/blogs/convert-pwa-to-ios-app-fast-2026); [Plushcap Ionic blog digest](https://www.plushcap.com/companies/ionic/blog/summaries/2026/07)
- Expo SDK 56 (21 May 2026): React Native 0.85, React 19.2, Expo UI production-ready; Expo Router dropped its React Navigation dependency; SDK 57 (30 Jun 2026) on RN 0.86 reported with zero breaking changes. New Architecture only since RN 0.82 (Oct 2025). — [Expo SDK 56](https://expo.dev/sdk/56); [React Native 2026 stack overview](https://pasqualepillitteri.it/de/news/8282/react-native-2026-stack-vergleich-flutter)
- React Native Reusables is a shadcn-shaped port using NativeWind (Tailwind for RN) and now supports Uniwind; Tamagui and gluestack are universal (web+native) alternatives. — [React Native Reusables](https://www.reactnativereusables.com); [VP0](https://vp0.com/blogs/shadcn-equivalent-react-native-mobile/)

### Inferences
- Web-only TanStack Router and shadcn DOM components do not run on RN. Shareable assets: the API client (generated from OpenAPI or tRPC-style types), Zod schemas, TanStack Query hooks, SSE event reducer, state machines/derived selectors (coverage computation, stale markers, amendment-level calculation). Structure the repo as a monorepo (pnpm workspaces): `packages/api-client`, `packages/schemas`, `packages/domain`, `apps/web`, later `apps/mobile`.
- Keep UI logic out of components (hooks + pure functions) so ~40-60% of non-view code (my estimate, not sourced) carries over.
- MVP screens that matter on a phone (review queue, triage, audit, thread, timeline) are card lists and sheets: simple to rebuild in RN; the heavy plan editor stays desktop-first per the MVP doc.
- Decide PWA-vs-native by the push requirement: if engineers need reliable push for "decision needed" alerts, iOS PWA push (installed-only, user-enabled) may be insufficient and Expo's native push is the upgrade. The MVP already lists notifications in Phase 4.
- Rejected: Flutter/Kotlin Multiplatform (zero code reuse with a TS web codebase); Tamagui (compiler complexity, smaller agent training data); Capacitor as default (works, but ties the mobile UX to a WebView and the deprecated Appflow ecosystem; remains the fallback).

### Gaps
- No hard data on realistic code-sharing percentages web to Expo with shadcn-style stacks; figure above is an estimate.
- Expo Router web output and RN support for SSE streaming not verified.
- Current Capacitor stable major (8.x vs 9) and Uniwind/NativeWind v5 status not confirmed from primary sources.

## 6. AI-agent authoring fit (how well agents write each option)

### Takeaway
Mainstream, strongly-typed, convention-heavy choices (React, TS strict, Tailwind, shadcn, TanStack Query, Zod, RHF) maximize agent reliability; exotic or fast-moving APIs (Next.js caching/RSC, pre-1.0 dnd-kit/react, RC Start) reduce it.

### Cited Findings
- Models are "competent on the mainstream stack and noticeably shakier off the beaten path." — [React AI stack 2026](https://builder-proxy.humanx.co/blog/react-ai-stack-2026)
- Benchmarks cited by Addy Osmani: ~42% on Next.js framework-specific tasks, ~25% multi-step full-stack integration, 20-43% on complex GitHub issue fixes; "context engineering matters more than model selection". — [Addy Osmani](https://addyosmani.com/blog/how-good-is-ai-at-coding-react-really/)
- State of JS 2025: Claude use among respondents doubled to 44%, Cursor to 26% (the user population is AI-coding-heavy, so ecosystem docs/skills increasingly target agents; e.g. Expo SDK 56 advertises "AI-friendly project scaffolding"). — [InfoQ](https://www.infoq.com/news/2026/03/state-of-js-survey-2025); [Expo SDK 56](https://expo.dev/sdk/56)

### Inferences
- Add to the repo: strict TS (`strict`, `noUncheckedIndexedAccess`), ESLint + Prettier, Vitest + Testing Library, Playwright component/e2e, Storybook (or a component gallery route) for visual regression at 375px, and a UI rules skill. Agents iterate faster against fast, deterministic checks than against taste.
- Pin versions and enable Renovate; avoid pre-1.0 UI libs in core paths.

### Gaps
- Benchmarks above come from a blog citing other benchmarks; no primary benchmark comparing React vs Svelte/Vue agent performance found.

## Final recommendation (summary for the report writer)

| Layer | Pick | Rejected (reason) |
| --- | --- | --- |
| Framework | React 19 + TS strict + Vite 8 SPA | Next.js (SSR/caching complexity, agent weakness, no SEO need); SvelteKit/Vue/Solid (smaller training set, no RN reuse) |
| Routing | TanStack Router (file-based) | Start (RC/uncertain status; revisit); React Router v7 as fallback |
| UI | Tailwind v4 + shadcn/ui (Base UI) | MUI/Ant/Chakra; CSS-in-JS |
| Server state | TanStack Query v5 | Redux Toolkit/RTK Query (more boilerplate); SWR |
| Client state | Zustand + URL search params | Redux |
| Forms | React Hook Form + Zod | TanStack Form (younger; only if nested forms get complex), Formik |
| Reorder | dnd-kit core/sortable + move buttons | @dnd-kit/react (0.x), react-beautiful-dnd (deprecated; not verified here) |
| Diff | `diff` for structured plan diffs; react-diff-view for code diffs | react-diff-viewer (stale since 2024) |
| Text editing | Textarea/markdown preview, Tiptap or CodeMirror 6 in leaf fields | Whole-plan-in-Lexical/Tiptap; Tiptap paid collab features |
| Streaming | fetch-based SSE + resume by event id | WebSocket (bidirectional not needed in browser) |
| Mobile | PWA now; Expo + shared TS packages later | Capacitor (fallback), Flutter/KMP |

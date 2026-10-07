# Developer tooling for AI-agent-driven development (Plangineer), state as of October 2026

Context: Plangineer is a TypeScript monorepo (web app, API/control plane, local runner, shared packages) written, reviewed and tested almost entirely by Claude Code, Codex and Cursor ([mvp.md](C:\Users\shane\Documents\Apps\Plangineer\docs\product\mvp.md)). Dates are from search results; research was ~40 tool calls, so some items are flagged as gaps. Facts come from cited sources; anything marked "Inference" is my reasoning.

## 1. Which linter/formatter combo is best in 2026 for agent feedback speed and strictness?

### Takeaway
Primary recommendation: **Oxlint (with tsgolint type-aware rules, `typeAware` + `typeCheck` on) + Oxfmt, on TypeScript 7 (native compiler)**, with a small set of custom lint rules (JS plugins) for repo-specific remediation messages. The decisive fact is that TypeScript 7.0 shipped without the programmatic API, so typescript-eslint cannot run on TS 7 until TS 7.1; tsgolint is built on the TS 7 Go compiler and already runs on it. Fallback if Oxfmt's beta status bothers you: Biome as formatter only (or Prettier). Rejected: ESLint+typescript-eslint+Prettier as the primary (slow, and pinned to TS 6.0), Biome as the linter (partial type inference, ~75-85% of typescript-eslint's floating-promise coverage).

### Cited Findings
- TypeScript 7.0 released Aug 3, 2026; 8x-12x faster full builds (VS Code 125.7s to 10.6s); `strict` and `esnext` are now default; TS 6.0 deprecations became hard errors — [InfoQ](https://infoq.com/news/2026/08/typescript-7-released/)
- TS 7.0 ships without a stable programmatic API (expected in 7.1); typescript-eslint, Vue/Svelte/Astro tooling and esbuild-style tools are incompatible until then; a `@typescript/typescript6` compat package gives a `tsc6` binary — [InfoQ](https://infoq.com/news/2026/08/typescript-7-released/)
- typescript-eslint's parser peer-depends on `typescript >=6.0 <6.1` (v8.66.0); a TS7 support request was closed "not planned" pending 7.1; teams are told to keep TS 6.x for ESLint — [DEV Community](https://dev.to/the-modern-web/why-angular-vue-and-eslint-cant-upgrade-to-typescript-70-yet-and-why-ts-71-changes-441g), [classmethod](https://dev.classmethod.jp/en/articles/dependabot-major-bump-ecosystem-lag/)
- TS 7.1 beta reportedly dropped Oct 6, 2026 with the stable programmatic API (single secondary source; typescript-eslint has not yet confirmed support) — [digitalapplied/ecorpit roundup via search](https://ecorpit.com/typescript-7-migration-readiness-eslint-astro-blockers-2026/)
- tsgolint v7.0.2000 (stable) tracks TypeScript 7.0.2; covers 59 of typescript-eslint's 61 type-aware rules; 12-18x faster than ESLint+typescript-eslint on vscode, TypeScript, typeorm, vuejs/core; `typeAware: true` and `typeCheck: true` can be set in config; release July 22, 2026 — [Oxc blog](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable), [InfoQ](https://infoq.com/news/2026/09/tsgolint-oxlint-typescript)
- Oxlint `--type-check` reports TypeScript compiler errors alongside lint diagnostics (so lint and typecheck can be one pass) — [InfoQ](https://infoq.com/news/2026/09/tsgolint-oxlint-typescript)
- Oxlint JS plugins: ESLint v9+-compatible plugin API, custom rules in JS/TS, autofix and suggestions, IDE diagnostics; announced as alpha March 2026; tested against ESLint's own rule test suite and plugins (React hooks 100%, SonarJS 99.6%) — [Oxc JS plugins alpha](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha), [docs](https://oxc.rs/docs/guide/usage/linter/js-plugins)
- Oxlint ships `import/no-cycle` and `no-restricted-imports` (regex patterns with custom messages) natively; multi-file rules ran over 126,000 files in 7 seconds — [search summary of Oxc docs](https://oxc.rs/docs/guide/usage/linter/rules/import/no-cycle)
- Oxfmt reached beta Feb 2026: passes 100% of Prettier's JS/TS conformance tests, >30x faster than Prettier and ~3x faster than Biome, import sorting and Tailwind class sorting built in; a 1.0 date was not announced in what I found — [Oxc blog](https://oxc.rs/blog/2026-02-24-oxfmt-beta)
- Biome is at 2.5.x (changelog shows 2.5.6); type-aware rules use Biome's own type inference, not tsc, and accept false negatives; one tracker estimates `noFloatingPromises` catches ~75-85% of what typescript-eslint catches — [Biome changelog](https://biomejs.dev/internals/changelog/version/2-5-6/), [Biome blog](https://biomejs.dev/blog/vercel-partners-biome-type-inference), [urandom.io](https://urandom.io/blog/2026-02-17-biome-kills-eslint-no-really)
- ESLint 10.0.0 shipped Feb 6, 2026 (flat config only); typescript-eslint v8.x supports ESLint 10, but React/a11y plugin peer ranges lag — [tech-insider](https://tech-insider.org/eslint-vs-biome-vs-oxlint-2026/), [classmethod](https://dev.classmethod.jp/en/articles/dependabot-major-bump-ecosystem-lag/)
- Weekly downloads May 2026: ESLint ~134M, Biome ~8.8M, Oxlint ~6.7M (ecosystem size matters for plugin availability) — [tech-insider](https://tech-insider.org/eslint-vs-biome-vs-oxlint-2026/)
- Factory's recommended agent-oriented lint categories: grep-ability (named exports, no default exports), glob-ability (predictable file layout), architectural boundaries, security, testability (tests next to code, no network in unit tests), observability (structured logging), documentation signals — [Factory](https://factory.com/using-linters-to-direct-agents)

### Inferences
- Because Plangineer is greenfield with no legacy ESLint plugins, the main reason to stay on ESLint (plugin ecosystem) is weak; the TS 7 blocker makes it actively costly. Running TS 7 `tsc` for typecheck (seconds) plus oxlint+tsgolint (sub-second to low seconds) is the fastest deterministic loop available.
- If a needed ESLint-only plugin (e.g. a React/a11y plugin) is not covered by Oxlint's native rules, load it via `jsPlugins`; keep it minimal because the JS-plugin API was alpha as of March 2026 and I did not confirm a stable promotion.
- Oxfmt beta risk is low for a prototype: formatting output is Prettier-identical per conformance tests, and a formatter swap is a one-command change.
- Pin TypeScript to 7.x and let tsgolint's version track it (tsgolint's version scheme encodes the TS version).

### Gaps
- Did not confirm Oxlint JS plugins left alpha, or Oxfmt reached 1.0, as of Oct 2026.
- Did not verify the TS 7.1 beta claim against Microsoft's own post, nor whether typescript-eslint announced 7.1 support.
- No head-to-head agent-benchmark of Biome vs Oxlint feedback loops found; speed claims are vendor/blog benchmarks.

## 2. How to enforce clean architecture boundaries mechanically so agents cannot violate them?

### Takeaway
Layer it: (1) **package boundaries via pnpm workspaces** (a package can only import what it declares in `package.json`; with `pnpm` strict node_modules undeclared imports fail), (2) **dependency-cruiser** as the authoritative, graph-level architecture gate (forbidden layer edges, cycles, orphans) with custom `comment` text that tells the agent how to fix, (3) Oxlint `no-restricted-imports`/`import/no-cycle` for instant in-edit feedback, (4) **Knip** for dead code/unlisted deps. Nx module-boundary tags are the strongest turnkey option but require adopting Nx; not recommended unless you pick Nx.

### Cited Findings
- OpenAI's million-line Codex-only project kept coherence via "layered architecture enforced by custom linters and structural tests", with fixed dependency directions, strict layer boundaries, naming conventions, file-size limits and structured-log naming, plus recurring "garbage collection" passes where agents scan for drift — [OpenAI](https://www.openai.com/index/harness-engineering) (as summarized by [Martin Fowler](https://martinfowler.com/articles/harness-engineering.html), [search summary](https://rywalker.com/research/openai-harness)); direct fetch of OpenAI's page returned 403 so numeric details (layer names, file-size limits) are unverified
- Fowler/Thoughtworks: custom linter messages that include self-correction instructions are "a positive kind of prompt injection"; architecture fitness functions are part of the harness; feedback-only gives an agent that repeats mistakes, feedforward-only never learns whether rules worked, so you need both — [Martin Fowler](https://martinfowler.com/articles/harness-engineering.html)
- Fowler distinguishes computational controls (tests, linters, type checkers; deterministic, ms-seconds) from inferential ones (LLM review; slower, costly) — [Martin Fowler](https://martinfowler.com/articles/harness-engineering.html)
- dependency-cruiser enforces boundaries on the resolved import graph from repo root (ESM and require), which let the Ghost project drop a custom ESLint rule that missed ESM imports; it is powerful but heavy to configure and has no PR-diff mode or agent-oriented output — [Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/), search summary of Ghost/ArchGuard sources above
- eslint-plugin-boundaries defines layers/elements and gives instant lint feedback; Oxlint lacks the ESLint plugin ecosystem for custom boundary rules (Ghost example) — [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries), search result on Oxlint migration blockers
- Nx `@nx/enforce-module-boundaries` uses project tags and checks imports and package.json dependencies in lint; recommended mainly for multi-team repos (30+ devs) — [Nx docs](https://nx.dev/structure/monorepo-tags), [pkgpulse](https://www.pkgpulse.com/guides/turborepo-vs-nx-monorepo-2026)
- Knip finds unused files, exports, dependencies, unlisted dependencies, duplicate dependencies and unresolved imports in one run, with first-class workspace support, and is pitched for cleaning AI-generated leftovers; it has an MCP/skill ecosystem — [Knip](https://knip.dev/explanations/why-use-knip)
- ArchGuard is a newer agent-oriented boundary checker (agent JSON output, AGENTS.md sync, baseline mode) for React+TS; maturity unknown — [GitHub](https://github.com/lindseystead/archguard)

### Inferences
- For Plangineer's package split, express layers as packages (e.g. `domain` <- `application` <- `adapters`/`apps`) and have the dependency-cruiser config forbid edges, e.g. `domain` importing anything but itself and `zod`, `apps/web` importing `apps/api`, any package importing from `apps/*`. Package manager isolation then makes violations also fail at resolve time.
- Put the remediation in the rule's `comment` field ("web must not import api internals; import the contract from `@plangineer/contracts`") so error text doubles as instructions; this follows Fowler's remediation-message pattern. Exact dependency-cruiser output formats (`err`, `json`) were not verified by fetch; confirm in docs.
- Avoid adopting Nx purely for tags; dependency-cruiser + Oxlint gives equivalent enforcement without a build-system migration.
- Add structural size checks (max lines per file, max function length via Oxlint `max-lines`/`max-lines-per-function`) as OpenAI-style structural constraints; exact thresholds are a judgment call (suggest 300 lines/file, 50/function; unsourced).

### Gaps
- No primary-source numbers for OpenAI's file-size limits or layer model.
- No evidence found of eslint-plugin-boundaries running under Oxlint `jsPlugins`.
- Could not verify dependency-cruiser's current version or agent-friendliness of its output.

## 3. What hooks and CI gates produce the best outcomes with agents, and what should the single 'verify' command be?

### Takeaway
One `pnpm verify` script, identical locally, in the Claude Code Stop hook, in lefthook pre-push, and in CI: `format check` -> `oxlint --type-aware --type-check` -> `tsc -b` (or the oxlint type-check) -> `depcruise` -> `knip` -> `vitest run` -> (optionally) build, all orchestrated by Turborepo for caching/affected scoping. Keep a *fast* variant (`pnpm verify:fast`: format + lint on changed files) for PostToolUse. Heavy checks (mutation testing, e2e) go to CI or nightly only.

### Cited Findings
- Anthropic: "Give Claude a check it can run: tests, a build, a screenshot"; it is the difference between a session you watch and one you walk away from; options to enforce are in-prompt, `/goal`, a Stop hook that blocks the turn from ending until the script passes, or a verification subagent — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Anthropic: have Claude show evidence (test output, commands run) rather than assert success; use a fresh-context subagent as reviewer, but a reviewer asked to find gaps will usually report some, so tell it to flag only correctness/requirement gaps to avoid over-engineering — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Hooks are deterministic whereas CLAUDE.md is advisory; "If Claude already does something correctly without the instruction, delete it or convert it to a hook" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- Hook mechanics: exit code 2 blocks and sends stderr to Claude as feedback for most events; `PostToolUse` and `Stop` can return a top-level `decision: "block"` JSON; `PostToolUse` matcher `Edit|Write`; PostToolUse cannot undo the tool call; Stop hooks are overridden after 8 consecutive blocks with no tool call, and scripts must check `stop_hook_active` to avoid loops; per-hook `timeout` (seconds) is configurable; hooks go in `.claude/settings.json` — [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- Community guidance: keep fast checks (format, lint touched files) in PostToolUse, expensive suites in Stop/CI, return only important log lines on failure, put scripts in `.claude/hooks/` — [Proxify hooks playbook](https://agentic.proxify.io/setup/hooks-playbook), [codeongrass](https://codeongrass.com/blog/claude-code-hooks-done-means-tests-passed/) (practitioner sources, not Anthropic)
- Non-interactive mode `claude -p ... --output-format json|stream-json` for CI/pre-commit; `--permission-mode auto` classifier mode exists (v2.1.283+) — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Lefthook (Go, parallel, one `lefthook.yml`, no Node needed) vs Husky (~5M weekly downloads, ~1ms runtime, usually paired with lint-staged); both are commonly recommended — [pkgpulse](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026), [toolradar](https://toolradar.com/compare/husky-vs-lefthook), [Steve Kinney](https://stevekinney.com/courses/self-testing-ai-agents/git-hooks-with-lefthook)
- Versions: pnpm 12.5 (Sept 2026 digest; pnpm 11.x earlier in the year), Turborepo 2.11, Nx 23.1 (v23 June 16, 2026) — [releases.sh digest](https://releases.sh/collections/js-toolchain/digest/2026-09-14), [digest 2026-07-13](https://releases.sh/collections/js-toolchain/digest/2026-07-13)
- Pure TS-ecosystem opinion: Nx for 30+ devs/multiple squads; Turborepo is the lighter option — [pkgpulse](https://www.pkgpulse.com/guides/turborepo-vs-nx-monorepo-2026)

### Inferences
- Package manager/monorepo: **pnpm 12 workspaces + Turborepo 2.11**. Reasons: pnpm's strict isolation doubles as boundary enforcement; Turborepo is a thin task runner with remote/local cache and no codegen layer for agents to misunderstand. Rejected: Nx 23 (heavier config surface, more concepts per agent context; its main advantage, tag-based boundaries, is replaceable), Bun workspaces (runtime/package-manager immaturity for monorepo task caching; no agent-specific benefit found), npm/yarn (no strict isolation).
- Hook design (Inference): (a) PostToolUse `Edit|Write`: run `oxfmt` on the file then `oxlint` on that file only (<1s), exit 2 with terse output on errors; (b) Stop: run `pnpm verify` via turbo (cached), honor `stop_hook_active`, print only failing-task output; (c) PreToolUse on Bash to block `--no-verify`, `git push --force`, edits to `.claude/settings.json` and lint configs (stops agents loosening rules). Stop-hook on every turn is costly if verify is slow; Turbo caching and affected-only runs are what make it viable.
- Git hooks: lefthook pre-commit = format+lint staged files; pre-push = `pnpm verify`. Agents use `--no-verify`, so CI must re-run the identical `pnpm verify` as the authoritative gate and branch protection should require it. Choosing lefthook over Husky because it needs no Node bootstrap and is declarative; low stakes.
- CI (GitHub Actions): `pnpm/action-setup` + `actions/setup-node` with pnpm cache + Turborepo cache (`actions/cache` on `.turbo`, or remote cache); one required job running `pnpm verify`; separate non-required nightly job for mutation testing and dependency audit.
- Commit conventions: Conventional Commits only if release automation needs it; for a prototype with "no versioning" it adds noise. Recommend no commitlint; use short imperative messages. (Unsourced judgment.)

### Gaps
- No controlled study of Stop-hook-every-turn vs PR-only gating on agent outcomes.
- GitHub Actions caching specifics, lefthook/Husky versions, and Turborepo `--affected` semantics not fetched.
- Cursor and Codex hook equivalents were not researched (Claude Code hooks only); Plangineer runs all three, so `pnpm verify` + git hooks + CI must be the agent-agnostic backstop.

## 4. What does current guidance say about AGENTS.md content and size?

### Takeaway
Keep AGENTS.md short and operational (commands, non-obvious conventions, traps, links to deeper docs); do not auto-generate it, do not include repo overviews, and do not duplicate rules the linter enforces. Evidence is mixed on benefit: human-written files cut time/tokens but barely change correctness; LLM-generated files lowered success ~3% and raised cost >20%.

### Cited Findings
- Anthropic: CLAUDE.md should be short; for each line ask "Would removing this cause Claude to make mistakes?"; bloated files cause rules to be ignored; exclude anything inferable from code, standard conventions, file-by-file descriptions, self-evident advice like "write clean code"; use skills for sometimes-relevant knowledge; `@path` imports; `/doctor` proposes cuts — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- OpenAI harness post: "AGENTS.md should be a table of contents, not an encyclopedia", pointing to a `docs/` directory — [summary](https://rywalker.com/research/openai-harness) (OpenAI primary page returned 403; the ~100-line figure commonly quoted was NOT verifiable and is omitted)
- Lulla et al. (Jan 2026, ICSE JAWs workshop): 10 repos, 124 PRs; with a developer-written AGENTS.md median wall-clock time fell 28.64% and median output tokens fell 16.58%; efficiency only, correctness not measured — [arXiv 2601.20404](https://arxiv.org/pdf/2601.20404), [summary](https://codex.danielvaughan.com/2026/07/27/do-auto-generated-agents-md-files-actually-help-codex-cli/)
- Gloaguen et al. (ETH Zurich, Feb 2026): 4 agents, 138 issues, 12 repos; LLM-generated context files reduced success ~3%, both kinds raised inference cost >20%, developer-written files improved success ~4%; repo overviews were not helpful — [summary](https://codex.danielvaughan.com/2026/07/27/do-auto-generated-agents-md-files-actually-help-codex-cli/) (secondary source; the primary paper was not fetched)
- dos Santos et al. (June 2026): 91% of 100 popular repos' AGENTS.md/CLAUDE.md have at least one "smell": lint leakage 62%, context bloat 42%, skill leakage 35% — [same summary](https://codex.danielvaughan.com/2026/07/27/do-auto-generated-agents-md-files-actually-help-codex-cli/)
- Another practitioner roundup: useful sections are commands, testing, project structure, code style, git workflow, boundaries — [agents-md-cookbook](https://raw.githubusercontent.com/Taiizor/agents-md-cookbook/790e0ba0d9c7fc9b96992bd68f08e9bfcb4c217e/docs/best-practices.md) (low-authority)
- Claude Code and Codex both read AGENTS.md or CLAUDE.md; mvp.md says Claude Code reads `.claude/skills/`, Codex `.agents/skills/` — [mvp.md](C:\Users\shane\Documents\Apps\Plangineer\docs\product\mvp.md)

### Inferences
- Structure for Plangineer: `AGENTS.md` (<~100 lines, a suggestion, not a sourced limit) with: the one verify command and fast variants, package map in one line each, 5-10 non-obvious rules (prototype stage: breaking changes OK, no fallbacks, no versioning), pointers to `docs/architecture.md` and skills. `CLAUDE.md` = `@AGENTS.md` import plus Claude-only notes, avoiding two diverging copies.
- Style rules the linter enforces should NOT be restated (lint leakage); rules that cannot be linted (e.g. "no silent fallbacks") belong in AGENTS.md or a rule skill, and where possible become custom lint rules.
- The existing AGENTS.md demand for "clean code, senior-quality" is, per Anthropic's own exclusion list ("self-evident practices like 'write clean code'"), noise; replace with mechanical checks.
- Because mvp.md already plans rule skills (architecture, best practices), keep AGENTS.md thin and push detail into those skills, loaded on demand.

### Gaps
- Primary papers by Gloaguen et al. and dos Santos et al. not read directly; numbers come from one secondary blog.
- No hard evidence for an optimal line count.
- Study populations are Python-heavy (the 288-run study mentioned three Python repos); transfer to TypeScript is assumed.

## 5. Which tools to avoid because they slow agent loops or add noise?

### Takeaway
Avoid: typescript-eslint+ESLint as the primary (blocked on TS 7, slow), Prettier+ESLint stylistic rule stacks, Nx (for this size), Jest, MCP servers where a CLI works, always-on LLM review bots as a required gate, full-suite mutation testing in the inner loop, and sprawling AGENTS.md. Use sparingly: depcruise visual graphs, 100% coverage thresholds.

### Cited Findings
- Stryker with Vitest runner (`@stryker-mutator/vitest-runner`, `typescript-checker`) is the standard JS mutation tool; typical thresholds: high 90, low 70, break 60; target >80% on critical logic — [qaskills](https://qaskills.sh/blog/mutation-testing-stryker-guide)
- "100% coverage with weak assertions is useless; mutation testing proves tests catch bugs" — [qaskills](https://qaskills.sh/blog/mutation-testing-stryker-guide) (practitioner claim)
- Playwright CLI used ~27k tokens vs ~114k for Playwright MCP on one benchmark (from mvp.md; single independent comparison) — [Bug0](https://bug0.com/blog/playwright-cli-vs-playwright-mcp-ai-browser-testing-2026)
- Anthropic: CLI tools are "the most context-efficient way to interact with external services" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Anthropic warns reviewer agents prompted to find gaps will report some even for sound work, leading to over-engineering (extra abstraction, defensive code, tests for impossible cases) — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Study on language choice: Python-dominant commits had higher first-try commit rate than TypeScript-dominant (48.4% vs 41.7% Opus; 86.8% vs 63.3% GLM), though practitioners argue typed compiler feedback speeds repair; this contradicts the simple claim "types raise first-try success" — [arXiv 2602.17955](https://arxiv.org/abs/2602.17955v1) (via search summary, paper not read), [yuv.ai](https://yuv.ai/blog/why-ai-is-pushing-us-all-toward-typescript-and-why-thats-good), [tianpan.co](https://tianpan.co/blog/2026-07-02-the-compiler-is-the-cheapest-eval-youll-ever-run)

### Inferences
- Validation at boundaries: **Zod 4** (largest ecosystem, native with tRPC/OpenAPI/most form libs, one schema = type + runtime check) is the default; Valibot only where bundle size matters (browser). One source of truth in a shared `contracts` package consumed by web, API and runner. (Versions and benchmarks not researched; recommendation is judgment.)
- Strictest tsconfig (Inference from TS docs knowledge, not fetched): TS 7 defaults to `strict` + `esnext`; additionally set `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters` (or leave to Oxlint), `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly`, `noUncheckedSideEffectImports`, `skipLibCheck: true` for speed, plus TS project references / `composite` per package. Note TS 6.0 removed deprecated options, so check each flag against TS 7.
- Test runner: Vitest (not Jest) — fast, native TS/ESM, matches Vite web app; mutation testing with Stryker only nightly/CI on core domain packages, coverage thresholds as a floor (e.g. 80% lines on domain) not a target. Agents game coverage; mutation score on a few critical packages is a better quality signal. Thresholds are judgment.
- Code review bots (CodeRabbit, Copilot review, etc.): not researched in detail. Given Plangineer's own pipeline is an agent review + confirm + triage loop (mvp.md), do not add a second bot as a required check; at most advisory.
- Dependency/security scanning: `pnpm audit` + GitHub Dependabot/Renovate + Gitleaks/secret scanning + `pnpm` `minimumReleaseAge`-style supply-chain delay features should be enabled; none of these was researched in this session, so treat as standard practice not evidence-backed here.
- Avoid MCP for browser/dev tooling where a CLI exists (Playwright CLI), per the token numbers above.

### Gaps
- Dependency/security scanning, SAST, and review-bot comparisons not researched (out of tool-call budget).
- No evidence-backed mutation-testing results with coding agents beyond vendor-style guides.
- Zod/Valibot current versions and performance not researched.
- Cursor/Codex-specific configuration (`.cursor/rules`, Codex `config.toml`, sandboxing) not researched.

## Recommended stack at a glance (summary for the report writer)

| Concern | Primary | Rejected / why |
| --- | --- | --- |
| Package manager | pnpm 12 workspaces (strict isolation) | npm/yarn: no isolation; Bun workspaces: no agent benefit found, less mature task graph |
| Task runner | Turborepo 2.11 (cache, `--affected`) | Nx 23: heavier, tags replaceable by depcruise |
| Compiler | TypeScript 7.x native, strictest flags | TS 6 only if forced by tooling (typescript-eslint) |
| Lint | Oxlint + tsgolint (type-aware + type-check), custom JS-plugin rules with remediation text | ESLint 10 + typescript-eslint (blocked on TS 7.1, slower); Biome linter (partial type inference) |
| Format | Oxfmt (beta, Prettier-conformant) | Prettier (30x slower); Biome fmt is the fallback |
| Architecture | dependency-cruiser + Oxlint `no-restricted-imports`/`no-cycle` + pnpm isolation | Nx tags, eslint-plugin-boundaries (ESLint-bound) |
| Dead code | Knip | depcheck/ts-prune (narrower) |
| Boundary validation | Zod 4 in shared `contracts` package | Valibot only for bundle-critical client code |
| Tests | Vitest; Stryker nightly on core packages | Jest; coverage-only gates |
| Git hooks | lefthook (pre-commit fast, pre-push verify) | Husky+lint-staged is acceptable alternative |
| CI | GitHub Actions, one required `pnpm verify` job with pnpm+Turbo cache | Many bespoke jobs; LLM review as blocking gate |
| Claude Code | PostToolUse format+lint, Stop `pnpm verify`, PreToolUse guard on config/`--no-verify`, thin AGENTS.md + `CLAUDE.md` importing it, rule skills | Long CLAUDE.md; reliance on prose rules |

Honesty note: recommendations marked Inference (tsconfig flags, thresholds, Zod, scanning, lefthook, hook design) rest on my judgment, not on sources fetched in this session.

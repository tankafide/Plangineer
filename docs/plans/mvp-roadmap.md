# MVP roadmap

Oct 7, 2026

This roadmap splits the [MVP](../product/mvp.md) into ten chunks, and each chunk gets its own plan. It is not a plan in the plan format and is not reviewed as one. Each chunk ends in a gate that can be demonstrated and checked, and builds only on the chunks before it.

Chunks 1 to 9 cover MVP Phases 1 to 3. Chunk 10 is Phase 4, which is rollout and can come after the MVP. The [desktop app](#desktop-app-distribution-track) is a distribution track outside the numbered chunks, planned next because installing Plangineer is still a developer checkout.

## Where things stand

| Item | Status |
| --- | --- |
| Phase 0 loop | The four orchestrators and the rule skills are written in `.agents/skills/`, and the scaffold went through the full loop. The MVP's exit gate asks for 3 to 5 features |
| Skill specification and baseline catalog | Written on Oct 8, 2026 as the [skill specification](../product/skill-specification.md) and the [baseline catalog](../product/baseline-catalog.md) |
| Project scaffold | Merged to `main` on Oct 7, 2026. It includes the workspace, every check, CI on three systems, local Postgres, GitHub sign-in, the user record with its admin or member role, and the development GitHub App |
| Skills mirror | The runner's `skills sync` and `skills check` commands sync and check this repository, through `pnpm skills:sync`, `pnpm verify` and the pre-commit hook. A run fails with `skills_drift` when its worktree's mirror drifts |
| Runner | Chunk 1 built it: pairing by a copied one-time code, one WebSocket to the API, dispatch from the `runs` table with leases and a sweeper, the Claude Code adapter in plan mode, a worktree per run, plan limits, and SSE to the Runs screens. It runs from the checkout with `pnpm runner`, and `pnpm runner:fake` runs it with the fake agent |
| Repository setup | Chunk 2 built it on Oct 8, 2026, as the [repository setup plan](2026-10-08-repository-setup.md) describes: adding a repository, the scan, the three checklists, and one setup pull request with the four orchestrators and the chosen rule skills. Each repository's workflow settings are on its settings card |
| Runner on npm | The runner is prepared for publishing to npm as `plangineer-runner`. The engineer publishes it with `pnpm runner:publish` |
| Browser pairing | Replaced the copied code with `plangineer-runner login --server <url>`, which opens an approval page in the browser, as the [runner browser pairing plan](2026-10-08-runner-browser-pairing.md) describes. The engineer publishes runner 0.2.0 with `pnpm runner:publish` |
| Desktop app | Next. A desktop app that runs the whole stack on one machine with no Node, Docker or terminal, built so it can grow into a team server. It gets its own plan, described under [Desktop app](#desktop-app-distribution-track) |
| Cross-repository orchestrators | Not built. They get their own plan |

## Chunks

| # | Chunk | MVP phase | Gate |
| --- | --- | --- | --- |
| 1 | Runner and run pipeline | 1 | The app sends a job to a paired runner, and a `claude -p` run streams events back on Windows, macOS and Linux |
| 2 | Repository setup | 1 | A real repository gets a setup pull request with its orchestrators and rule skills |
| 3 | Feature intake and pre-planning | 1 | A submitted feature produces context files and reaches plan ready |
| 4 | Planning session | 1 | An engineer goes from context files to a ready plan mostly by clicking |
| 5 | Plan workspace editing | 1 | Editing a step marks its tests stale, and any two revisions can be compared |
| 6 | Review pipeline on plans | 1 | A plan review raises findings, the author model confirms them, and fixes make a new revision |
| 7 | Approval and plan lifecycle | 1 | A real plan is approved through the app, which is the Phase 1 gate |
| 8 | Automated implementation | 2 | An approved plan becomes a pull request with nobody driving the agent |
| 9 | Codex and implementation review | 2 | A review on a different model produces a plan audit with every deviation decided, which is the Phase 2 gate |
| 10 | Verification | 3 | Every feature gets an evidence report, which is the Phase 3 gate |

Phase 4, auto-fix and rollout, stays out of the MVP. It covers fix commits that can be reverted, push notifications and metrics.

### 1. Runner and run pipeline

Every later chunk is checked against real agent runs, so the runner comes first.

- **Pairing.** The engineer signs the runner in to the app once. The runner stores a pairing token, and the app keeps only its hash and can revoke it.
- **Connection.** The runner keeps an outbound connection to the control plane and opens no inbound port.
- **Job queue.** The control plane queues one job per agent run and assigns it to a runner.
- **Claude Code adapter.** Starts the installed `claude` CLI in non-interactive mode under the engineer's own login, and turns its structured output into run events.
- **Event streaming.** Run events flow back to the app as the run works.
- **Worktrees.** One worktree per job for each repository the job involves.
- **Limits.** A concurrency limit, a queue for the rest, and reports when the machine is offline or a plan limit is reached.
- **Skills mirror.** `skills sync` and `skills check` move from the repository script into `plangineer-runner`, and the runner runs `skills check` before every run.
- **Records.** Runner and Run.

### 2. Repository setup

A feature cannot start until a repository has finished setup.

- **Prerequisites.** The skill specification and the baseline catalog, written as product docs.
- **Repository list.** Admins add repositories, each with a short description.
- **Repository settings.** The agent and model per role, where each role runs, how it signs in, and the workflow settings.
- **Setup flow.** Detect existing skills and agent instruction files, recommend from the baseline catalog, let the engineer choose from three checklists, generate the chosen skills and the four orchestrators, and open one setup pull request.
- **Existing skills.** Setup never rewrites one. A skill found only under `.claude/skills/` moves unchanged to `.agents/skills/`.
- **Mirror in the target repository.** The setup pull request adds `skills check` to CI and marks the mirror as generated in `.gitattributes`.
- **Cross-repository orchestrators.** Written from the repository descriptions once two or more repositories are configured, kept by the app and versioned.
- **Records.** Repository settings and Cross-repository orchestrator.

### 3. Feature intake and pre-planning

- **Feature tabs.** One tab per feature, each showing its status.
- **Intake form.** Description, ticket link, attachments, repositories, the exploration checkbox and research topics.
- **Repository picker.** Hidden with one repository. With several, **Not sure** runs a quick exploration that proposes the list for the engineer to confirm.
- **Jira connection.** Appears only when a ticket link needs it. The app adds the Jira MCP server to the engineer's CLI and walks them through sign-in.
- **Pre-planning tasks.** Intake, one exploration per repository and one research task per topic, running in parallel. Each records the commit it ran against.
- **Context files.** Open, edit, rename, delete and tick.
- **Plan ready.** Reached when the tasks finish. A failed task does not block it, and planning starts only when the engineer clicks Start planning.
- **Records.** Feature, Pre-planning task and Context file.

### 4. Planning session

- **Plan revision record.** Sections, acceptance criteria, source context files, base commit per repository and revision number. Never edited in place.
- **Guided loop.** Read context, decide or ask, draft, check for blockers, then repeat or finish.
- **Question cards.** One question at a time, as choices with a recommended option and a free-text answer.
- **Decisions.** Every call the agent makes alone is recorded with its reason.
- **Constraints.** The section appears from standing rules, exploration risk flags or intake wording, with proposed targets.
- **Plans across repositories.** Steps grouped by repository and phase, with cross-repository contracts under Decisions.
- **Readiness checklist.** A plan with an open question, a vague step, a missing "done when" line or an uncovered line cannot be marked ready.

### 5. Plan workspace editing

- **Section rail.** Each section shows complete, open question or findings.
- **Step cards.** Reorder, edit, or hand a step to the agent to revise.
- **Section actions.** Expand, simplify or regenerate one section.
- **Coverage grid.** One row per "done when" line, with columns for unit, integration, end to end, agent check and human check. A row with nothing ticked is a gap.
- **Stale markers.** Editing a step flags the tests and checks that depend on it.
- **Revision history.** Side-by-side diff of any two revisions.
- **Phone width.** Every view works as one column.

### 6. Review pipeline on plans

The finding pipeline is built once here, on plans, and chunk 9 reuses it for diffs.

- **Finding record.** Location, claim, kind, severity, suggested change, source skill, author verdict, rule outcome and decision.
- **Pipeline.** Review, confirm by the authoring model, apply triage rules, fix, and assess the round.
- **Triage rules.** Read from the repository, and applied as the plan review's `findings` setting says.
- **Re-review.** The plan review's `rounds` setting: under `ask`, the engineer sees the assessment and chooses whether to review again.
- **Inline findings.** Shown against the plan lines they refer to, with accept and reject buttons. Disputed findings are collapsed and can be overruled.
- **Triage screen.** One finding per card.

### 7. Approval and plan lifecycle

- **Plan thread.** Anyone can ask a question. An agent with the plan, its context files and read access to the repository answers, and an answer can become a suggested plan change.
- **Peer approval.** Approve or request changes, with trivial changes skipping it.
- **Review queue.** Plans waiting for approval and findings waiting for a decision.
- **Notifications.** The in-app inbox, fed by the same events as the timeline.
- **Staleness check.** Driven by GitHub push webhooks. It compares files changed on main since the base commit with the plan's files, warns on overlap, and supports dismissal and Replan.
- **Amendments.** Decision only, approach and scope levels, set from which sections changed, with review of the diff only.
- **Records.** Thread message, Approval, Staleness dismissal and Notification.

### 8. Automated implementation

- **Run dispatch.** Approval queues the implementation run.
- **Isolated workspaces.** A fresh checkout of the feature branch per run, with the approved plan revision written into the workspace and not committed.
- **Implementation run.** The implementation orchestrator works from the approved revision and logs each departure with its reason.
- **Undecided points.** The run stops and the feature goes to the amendment path.
- **Multiple repositories.** Work runs in the order the plan's phases set.
- **Pull requests.** One per repository, with the plan summary attached.
- **Run timeline.** Current stage, round, skills loaded and cost so far.
- **Hosted runners.** CI jobs serve implementation and review. If this chunk grows past the scaffold plan's size, hosted runners become their own chunk.

### 9. Codex and implementation review

- **Codex adapter.** `codex exec` produces the same run events as the Claude Code adapter.
- **Implementation review.** The chunk 6 pipeline, applied to the diff against the plan and the rule skills.
- **Deviations and extras.** Every step matched to the diff and every change matched to a step. A departure the implementer did not log is marked unreported.
- **Decisions.** Accept, revert or replan, always made by an engineer.
- **Plan audit.** Every step as built as planned, deviated or not built, then every extra, each with who decided and why.
- **Pull request.** The audit and the findings history are attached.

### 10. Verification

- **Deploy webhook.** Reports which build is live and where. A multi-repository feature starts verification once every repository's change is live.
- **Test agent.** A separate run that sees the plan and the environment, never the implementation session.
- **Checks.** API checks from the shell and web checks through Playwright CLI.
- **Verdicts.** Pass, fail or blocked for each acceptance criterion.
- **Evidence.** Request and response logs, screenshots and page snapshots in object storage.
- **Report.** The verification report screen, with a failure sending the feature back to its author.
- **Records.** Verification result.

## Desktop app (distribution track)

Installing Plangineer is a developer checkout today: Node 24, Docker Desktop, `pnpm install`, `pnpm setup:env`, `pnpm setup:github-app` and `pnpm dev`, then a runner paired with `npx plangineer-runner login`. This track replaces that with one installer for a solo engineer on one machine. It grows into a team-hosted server later, from the same server code.

**Gate.** A person downloads the app, opens it, clicks through GitHub twice and signs in, and reaches a paired, online runner without a terminal, on Windows, macOS and Linux.

- **Shell.** An Electron or Tauri window on the app. The plan picks one, and says how Node and the server code are bundled.
- **Postgres without Docker.** Real Postgres binaries, never PGlite, started and stopped by the app, with data under `env-paths`. The plan picks the packaging, for example the `embedded-postgres` package, and says how migrations run on upgrade.
- **First run.** The app creates `.env` and the auth secret, runs migrations and seed, starts the API and web app, and opens the window.
- **Runner included.** The app installs, pairs and runs the runner on the same machine with no `npx` and no approval page, and keeps it running at login. A second machine still pairs with `plangineer-runner login`. Shipping the runner as a standalone binary with no Node is part of the plan.
- **First-run checklist.** One screen with four steps: create the GitHub App, sign in, detect Claude Code, add the first repository.
- **Steps that stay manual.** The click that creates the GitHub App and the choice of repositories to install it on (GitHub requires a signed-in person), the GitHub sign-in consent, and the Claude Code sign-in. The app only detects whether Claude Code is installed and guides the user. It never reads, stores or relays a vendor login.
- **Growth path to a team server.** Option 3 is the same server code with a different launcher:
- **A thin shell.** The desktop app holds no server logic. It starts the same API, web app and Postgres that a team deployment runs, and opens a window on them.
- **Two settings carry the growth path.** `DATABASE_URL` picks the Postgres, and the public origin (`BETTER_AUTH_URL` and the GitHub App callback URLs) is a setting and never a hard-coded `localhost`.
- **No single-user shortcut.** Sign-in and the admin and member roles apply as they do on a team server.
- **New work for a team server later.** A container image and deploy guide, a public HTTPS URL for GitHub webhooks, backups and upgrades, and moving a solo user's data by Postgres dump and restore.
- **Known limit.** GitHub webhooks need a public URL, so anything that depends on them does not work from a laptop without a tunnel.
- **Left out of the first version.** Hosted or team deployment, Codex, and the mobile app.

## Cross-cutting choices

- **Multi-repository support.** Built into each chunk from the start, because repository lists on features, base commits per repository and grouped steps shape the data model.
- **Phone width.** Every screen works as one column from its first chunk.
- **One API.** Every UI action goes through the API a mobile app will use.

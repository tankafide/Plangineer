# MVP roadmap

Oct 7, 2026, re-cut Oct 9, 2026

This roadmap splits the [MVP](../product/mvp.md) into nine chunks, and each chunk gets its own plan. It is not a plan in the plan format and is not reviewed as one. Each chunk ends in a gate that can be demonstrated and checked, and builds only on the chunks before it.

The roadmap targets the desktop app: one engineer, one machine, Claude Code, and an API that listens only on `127.0.0.1`. Anything that needs a second person, a public URL or a second agent CLI is listed under [After the MVP](#after-the-mvp).

## Where things stand

| Item | Status |
| --- | --- |
| Phase 0 loop | The four orchestrators and the rule skills are written in `.agents/skills/`, and the scaffold went through the full loop. The MVP's exit gate asks for 3 to 5 features |
| Skill specification and baseline catalog | Written on Oct 8, 2026 as the [skill specification](../product/skill-specification.md) and the [baseline catalog](../product/baseline-catalog.md) |
| Project scaffold | Merged to `main` on Oct 7, 2026. It includes the workspace, every check, CI on three systems, local Postgres, GitHub sign-in, the user record with its admin or member role, and the development GitHub App |
| Skills mirror | The runner's `skills sync` and `skills check` commands sync and check this repository, through `pnpm skills:sync`, `pnpm verify` and the pre-commit hook. A run fails with `skills_drift` when its worktree's mirror drifts |
| Runner | Chunk 1 built it: pairing, one WebSocket to the API, dispatch from the `runs` table with leases and a sweeper, the Claude Code adapter in plan mode, a worktree per run, plan limits, and SSE to the Runs screens. It runs from the checkout with `pnpm runner`, and `pnpm runner:fake` runs it with the fake agent |
| Repository setup | Chunk 2 built it on Oct 8, 2026, as the [repository setup plan](2026-10-08-repository-setup.md) describes: adding a repository, the scan, the three checklists, and one setup pull request with the four orchestrators and the chosen rule skills. Each repository's default run mode is on its settings card |
| Browser pairing | Replaced the copied code with `plangineer-runner login --server <url>`, which opens an approval page in the browser, as the [runner browser pairing plan](2026-10-08-runner-browser-pairing.md) describes |
| Feature intake | Chunk 3 built it on Oct 10, 2026, as the [feature intake plan](2026-10-09-feature-intake.md) describes: the intake form, intake, exploration and research tasks on the local runner, editable context files, run modes per feature, and plan ready |
| Planning | Chunk 4 built it on Oct 10, 2026, as the [planning plan](2026-10-10-planning.md) describes: guided planning turns on the local runner that ask questions and draft a structured plan, the plan workspace with section actions, step edits and the coverage grid, Auto loop drafting, and the revision diff |
| Desktop app | Built on Oct 9, 2026 from the [desktop app plan](2026-10-08-desktop-app.md). See [Desktop app](#desktop-app) |
| Releases | The engineer publishes runner 0.3.0 with `pnpm runner:publish`, and the first draft release of the desktop app, as the desktop app plan's D25 says |
| Roadmap re-cut | On Oct 9, 2026 the ten chunks became nine. See [What changed in the re-cut](#what-changed-in-the-re-cut) |

## Chunks

| # | Chunk | MVP phase | Status | Gate |
| --- | --- | --- | --- | --- |
| 1 | Runner and run pipeline | 1 | Built | The app sends a job to a paired runner, and a `claude -p` run streams events back on Windows, macOS and Linux |
| 2 | Repository setup | 1 | Built | A real repository gets a setup pull request with its orchestrators and rule skills |
| 3 | Feature intake and pre-planning | 1 | Built | A submitted feature produces context files and reaches plan ready |
| 4 | Planning | 1 | Built | An engineer goes from context files to a ready plan mostly by clicking, edits it, and compares any two revisions |
| 5 | Plan review and approval | 1 | Next | A plan review raises findings, the author model confirms them, fixes make a new revision, and the engineer approves the plan. This is the Phase 1 gate |
| 6 | Implementation | 2 | | An approved plan becomes a pull request with nobody driving the agent |
| 7 | Implementation review | 2 | | A review on a different model from the implementer produces a plan audit with every deviation decided, and a feature under the Auto loop run mode goes from intake to an open pull request with nobody deciding. This is the Phase 2 gate |
| 8 | Verification | 3 | | Every feature gets an evidence report. This is the Phase 3 gate |
| 9 | Features across repositories | 1 to 3 | | One feature spanning two repositories goes from intake to one verified pull request per repository |

Chunks 3 to 8 build every stage for a feature in one repository. Every record is shaped for several repositories from chunk 3: a feature holds a list of repositories, a plan holds a base commit per repository, and a step names its repository. Chunk 9 then adds the cross-repository orchestrators and runs the stages across repositories.

The [run modes](../product/mvp.md#run-modes) grow the same way. Chunk 3 adds the run mode to the feature, and each later chunk makes its own stop point follow it.

### 3. Feature intake and pre-planning

- **Feature tabs.** One tab per feature, each showing its status.
- **Intake form.** Description, ticket link as a reference only, attachments, the exploration checkbox, research topics and the run mode. The repository picker lists the configured repositories and takes one. Several repositories and **Not sure** come in chunk 9.
- **Pre-planning tasks.** Intake, exploration and one research task per topic, running in parallel. Each records the commit it ran against.
- **Context files.** Open, edit, rename, delete and tick.
- **Plan ready.** Reached when the tasks finish. A failed task does not block it. Under Manual and Manual plan, planning starts when the engineer clicks Start planning. Under Auto loop it starts by itself, once chunk 4 exists.
- **Run modes.** Manual, Manual plan and Auto loop, each a fixed set of workflow settings. The repository's settings card replaces chunk 2's per-setting fields with a default run mode, and the feature's mode can change at any time.
- **Records.** Feature, Pre-planning task and Context file.

### 4. Planning

The planning session and the plan workspace are one chunk, because the session writes the sections the workspace edits. This chunk is the largest. If its plan grows past the scaffold plan's size, section actions and the revision diff become their own plan.

- **Plan revision record.** Sections, acceptance criteria, source context files, base commit per repository and revision number. Never edited in place.
- **Guided loop.** Read context, decide or ask, draft, check for blockers, then repeat or finish.
- **Question cards.** One question at a time, as choices with a recommended option and a free-text answer. Under Auto loop, `decisions` is `recommended`: the agent takes each recommended option and records it, and the check-in after the draft is skipped.
- **Decisions.** Every call the agent makes alone is recorded with its reason.
- **Constraints.** The section appears from standing rules, exploration risk flags or intake wording, with proposed targets.
- **Readiness checklist.** A plan with an open question, a vague step, a missing "done when" line or an uncovered line cannot be marked ready.
- **Section rail.** Each section shows complete, open question or findings.
- **Step cards.** Reorder, edit, or hand a step to the agent to revise.
- **Section actions.** Expand, simplify or regenerate one section.
- **Coverage grid.** One row per "done when" line, with columns for unit, integration, end to end, agent check and human check. A row with nothing ticked is a gap.
- **Stale markers.** Editing a step flags the tests and checks that depend on it.
- **Revision history.** Side-by-side diff of any two revisions.

### 5. Plan review and approval

The finding pipeline is built once here, on plans, and chunk 7 reuses it for diffs.

- **Finding record.** Location, claim, kind, severity, suggested change, source skill, author verdict, rule outcome and decision.
- **Pipeline.** Review, confirm by the authoring model, apply triage rules, fix, and assess the round.
- **Triage rules.** Read from the repository, and applied as the plan review's `findings` setting says.
- **Re-review.** The plan review's `rounds` setting: under `ask`, the engineer sees the assessment and chooses whether to review again. Auto loop sets `fix_all` and two fixed rounds.
- **Inline findings.** Shown against the plan lines they refer to, with accept and reject buttons. Disputed findings are collapsed and can be overruled.
- **Triage screen.** One finding per card.
- **Approval.** The engineer approves the plan once it has no open findings, which freezes the revision. Under Auto loop the app approves it and records the run mode as the reason. Peer approval waits for a team server.
- **Staleness check.** Runs when the plan is marked ready, when it is approved and when implementation starts. The runner fetches the repository and compares the files changed on main since the base commit with the plan's files. Overlap shows a warning with dismissal and Replan. Replan before approval makes a new revision. GitHub webhooks are not used, since the desktop app has no public URL.
- **Records.** Approval and Staleness dismissal.

### 6. Implementation

- **Run dispatch.** Approval queues the implementation run on the desktop's runner.
- **Worktrees.** A Git worktree of the feature branch per run, with the approved plan revision written into the worktree and not committed.
- **Implementation run.** The implementation orchestrator works from the approved revision and logs each departure with its reason.
- **Undecided points.** The run stops and the feature goes to the amendment path.
- **Amendments.** A new revision made from the approved one. The level, set from which sections changed, decides which sections plan review covers, and review covers the diff only. The engineer approves it, and implementation resumes on the same branch.
- **Pull request.** One for the repository, with the plan summary attached.
- **Run timeline.** Current stage, round, skills loaded and cost so far.
- **Notifications.** The in-app inbox and a system notification from the tray when a run stops, fails or needs a decision, and when the pull request opens. Every run mode stops for an open prerequisite, an undecided point, a failed check and a failed run.
- **Records.** Notification.

### 7. Implementation review

- **Implementation review.** The chunk 5 pipeline, applied to the diff against the plan and the rule skills. The reviewer runs on a different Claude model from the implementer by default.
- **Deviations and extras.** Every step matched to the diff and every change matched to a step. A departure the implementer did not log is marked unreported.
- **Decisions.** Accept, revert or replan, made by the engineer under Manual. Manual plan and Auto loop set `fix_all` and two fixed rounds, so the agent applies the recommended Accept or Revert. Replan goes through chunk 6's amendment path.
- **Plan audit.** Every step as built as planned, deviated or not built, then every extra, each with who decided and why.
- **Pull request.** The audit and the findings history are attached.

### 8. Verification

- **Environment.** Each repository's settings card holds a base URL, test accounts kept as runner secrets, and a note on safe seed data.
- **Start.** The engineer clicks Verify once the change is live, and picks the environment. A deploy webhook waits for a team server.
- **Test agent.** A separate run that sees the plan and the environment, never the implementation session.
- **Checks.** API checks from the shell and web checks through Playwright CLI.
- **Verdicts.** Pass, fail or blocked for each acceptance criterion.
- **Evidence.** Request and response logs, screenshots and page snapshots, kept as files in the app's data folder and linked from the result. Object storage waits for a team server.
- **Report.** The verification report screen, with a failure sending the feature back to its author.
- **Records.** Verification result.

### 9. Features across repositories

- **Cross-repository orchestrators.** Written from the repository descriptions once two or more repositories are configured, kept by the app and versioned.
- **Repository picker.** Several repositories, and **Not sure**, which runs a quick exploration across every configured repository and proposes the list for the engineer to confirm.
- **Pre-planning.** One exploration per repository.
- **Plans.** Steps grouped by repository and phase, with cross-repository contracts under Decisions, and test plan and verification rows tagged with their repository.
- **Implementation.** Work runs in the order the plan's phases set, with one pull request per repository.
- **Implementation review.** Runs per repository, then once across repositories for the contracts between them.
- **Verification.** Starts once every repository's change is live.
- **Records.** Cross-repository orchestrator.

## What changed in the re-cut

The ten chunks were written on Oct 7, 2026, before Plangineer became a desktop app. The re-cut fits them to one engineer on one machine.

| Before | After | Why |
| --- | --- | --- |
| 4. Planning session and 5. Plan workspace editing | 4. Planning | The session writes the sections the workspace edits, so one plan covers both |
| 6. Review pipeline on plans and 7. Approval and plan lifecycle | 5. Plan review and approval | With one engineer, approval is one click, and the rest of old chunk 7 needs a team server |
| Peer approval, trivial changes, plan thread, review queue | After the MVP, team server | Nobody else can reach a desktop API on `127.0.0.1` |
| Staleness check from push webhooks | Checked on demand in chunk 5 | Webhooks need a public URL |
| Amendments in old chunk 7 | Chunk 6 | A stopped run and Replan are what open an amendment |
| Hosted runners as CI jobs in old chunk 8 | After the MVP, team server | The desktop's runner serves every stage |
| 9. Codex and implementation review | 7. Implementation review, with Codex after the MVP | A different Claude model gives the review its second opinion |
| Deploy webhook and object storage in old chunk 10 | A Verify button and evidence files on disk in chunk 8 | No public URL and no Docker on the desktop |
| Workflow settings edited per repository | Three run modes chosen per feature, built from chunk 3 | An engineer chooses per feature between deciding everything, planning by hand, or the auto loop |
| Several repositories in every chunk, cross-repository orchestrators in old chunk 2 | 9. Features across repositories | Chunks 3 to 8 prove the stages on one repository first, on records already shaped for several |

## Desktop app

Plangineer ships as an Electron desktop app, and the [desktop app plan](2026-10-08-desktop-app.md) holds the design. The [desktop app guide](../engineering/desktop-app.md) covers installing and running it. Chunks 3 to 9 are built and tested inside it.

**Gate.** A person downloads the app, opens it, clicks through GitHub twice and signs in, and reaches a paired, online runner without a terminal, on Windows, macOS and Linux.

- **Shell.** Electron 44, packaged with electron-builder and updated with electron-updater. The API, the migrations and the runner run as tsdown bundles on Electron's Node 24.
- **Postgres without Docker.** Postgres 18 binaries from theseus-rs, started and stopped with `pg_ctl`, with data under `env-paths`. Every start runs migrations before the API.
- **Runner included.** The app pairs and runs the runner on the same machine and keeps it running at login. A second machine still pairs with `plangineer-runner login`.
- **First-run checklist.** One screen with four steps: create the GitHub App, sign in, detect Claude Code, add the first repository.
- **A thin shell.** The desktop app holds no server logic. It starts the same API, web UI and Postgres that a team server runs, and opens a window on them.
- **Two settings carry the growth path.** `DATABASE_URL` picks the Postgres, and the public origin (`BETTER_AUTH_URL` and the GitHub App callback URLs) is a setting and never a hard-coded `localhost`.
- **No single-user shortcut.** Sign-in and the admin and member roles apply as they do on a team server.

## After the MVP

**Team server.** A container image and deploy guide, a public HTTPS URL, backups and upgrades, and moving a solo user's data by Postgres dump and restore. With a team server come the features that need a second person or a public URL:

- Peer approval, with trivial changes skipping it, and the original approver for scope amendments.
- The plan thread and the review queue.
- The staleness check driven by GitHub push webhooks, and the deploy webhook that starts verification.
- Hosted runners, first as CI jobs, so runs continue with the laptop closed.
- Evidence in object storage.

These questions were raised while building the desktop app and are settled when team server work is planned:

- How a second machine pairs its runner while the desktop API listens only on `127.0.0.1`. The desktop app plan's D13 says `plangineer-runner login` still works there, which its C1 rules out.
- Whether changing only **Callback URL** and **Setup URL** on GitHub is enough after a port or origin change, as the [desktop app guide](../engineering/desktop-app.md#change-a-port) says. GitHub shows no redirect URL to edit after the App is created.
- Whether a team server can rely on keeping the desktop's `BETTER_AUTH_SECRET` to decrypt the stored GitHub App, or needs a way to re-encrypt it.
- How to reach `pg_dump` inside the Linux AppImage. The guide's `--appimage-extract` route is untested.

**Custom run modes.** A team sets each stop point itself and saves the set as its own mode.

**Ticket trackers.** Reading a ticket from its link, starting with Jira through Atlassian's MCP server. Taken out of chunk 3 on Oct 10, 2026.

**Codex adapter.** `codex exec` produces the same run events as the Claude Code adapter, so review can run on a different vendor.

**Auto-fix and rollout.** The MVP's Phase 4: fix commits that can be reverted, push notifications and metrics.

**Phone app.** Connects to the engineer's desktop. How it reaches an API that listens only on `127.0.0.1` is an open decision in the [MVP](../product/mvp.md#open-decisions).

## Cross-cutting choices

- **Records shaped for several repositories.** Repository lists on features, base commits per repository and a repository on each step shape the data model, so chunk 3 builds them that way even though chunk 9 runs them.
- **Phone width.** Every screen works as one column from its first chunk, so the later phone app reuses it.
- **Run modes.** Every stop point a chunk adds reads the feature's run mode, and every mode still stops for an open prerequisite, an undecided point, a failed check and a failed run.
- **One API.** Every UI action goes through the API a phone app will use.
- **Worktrees.** Agent runs work in Git worktrees the runner owns, and nothing switches branches in a working copy.

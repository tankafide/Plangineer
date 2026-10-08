# Plan-driven engineering workflow: design proposal and build plan

Oct 6, 2026 · @Shane

This proposes a web app that takes a feature from a reviewed plan to verified code. Engineers write and review plans; agents implement, review and test against the plan and the team's skills. It is an open-source project that each team self-hosts. Testing mobile apps and auditing skills are out of scope for this version. A mobile app for the product itself comes later, and the UI is designed now so it carries over.

## At a glance

&#91;embedded content: feature lifecycle · 12 steps, 2 review loops\]

Engineers spend their time in the top row. After peer approval the only human steps are merge and whatever findings the triage rules send to an engineer.

## Why build this

The workflow already works. This product automates a process @Shane runs by hand today, which consistently produces high-quality results. Each step exists because of something learned about working with models.

## Goals and non-goals

The goal is a workflow where the plan is the unit of engineering review, and code that matches an approved plan needs little human review.

**Goals**

- Make plan-making the standout: interactive, mostly clicks and choices, with agent review and peer review in one place.
- Settle every decision during planning through guided questions, so implementation never stops to ask.
- Give engineers a GUI over the Claude Code or Codex CLI for pre-planning work, organized as one tab per feature. Claude Code comes first, and Codex follows.
- Set up any repository: detect its skills, recommend what is missing, and generate the four orchestrators.
- Work across repositories: configure several, and let one feature and one plan span as many of them as it needs.
- Run implementation and implementation review automatically once a plan is approved.
- Apply the repo's skills at planning, implementation and review.
- Support review by a different model, which is the recommended setup, and have the authoring model confirm each finding.
- Let triage rules decide what to act on, starting with engineer sign-off and moving to `fix_all` as trust grows.
- Test the deployed result against the plan's acceptance criteria, through API calls and the web app.
- Keep the whole product point-and-click: checkboxes, buttons and choices over typed commands.
- Design every screen to work at phone width, so a mobile app can follow without a redesign.
- Show every place the implementation departs from the approved plan, and have the engineer decide each one.
- Run on each engineer's existing Claude or ChatGPT subscription, with API keys as an option and not a requirement.
- Ship as open source that any team can self-host with one container and a Postgres database.
- Work the same on Windows, macOS and Linux: the local runner, the self-hosted deployment and development of Plangineer itself.

**Non-goals for this version**

- Testing mobile apps in the verification stage.
- Auditing skill performance, or tracing which skill produced which line.
- Keeping plans as long-lived documentation. A plan is a harness for one change and is discarded after merge.
- Replacing the Git host, CI or deployment pipeline.
- Shipping a mobile app. The UI is designed for one, and the app itself comes later.
- Supporting the Cursor CLI. The adapter design allows it later.
- Running a hosted, multi-tenant service. Each deployment serves one team.

## Workflow stages

A feature moves through eight stages, and each has one gate that must clear before the next begins.

| Stage | Who acts | What happens | Gate |
| --- | --- | --- | --- |
| 1. Prepare | Engineer with agent CLIs | Submits a new feature with whatever they have and picks the repositories involved; exploration of each repository and any requested research run in parallel, each producing a context file | Feature is plan ready and the engineer starts planning |
| 2. Plan | Engineer with the plan orchestrator | Works through a guided planning session: the agent asks questions until nothing is undecided, then drafts the plan from the ticked context files and the team template | No open questions, and the author marks it ready |
| 3. Plan review | Plan review orchestrator, ideally on a different model, then the planning model, then triage rules | Findings are raised, confirmed and sorted; the plan is revised | No open findings |
| 4. Peer approval | Other engineers | Read the plan, ask questions in the plan thread, then approve or request changes. Skipped for trivial changes | Approval |
| 5. Implement | Implementation orchestrator | Builds on a branch in an isolated workspace from the approved plan revision | Build and tests pass |
| 6. Implementation review | Implementation review orchestrator, ideally on a different model, then the implementing model, then triage rules | The diff is checked against the plan and the rule skills. Findings, including every deviation from the plan and every extra, are raised, confirmed and sorted; fixes are applied, and an agent recommends whether to review again | No open findings, and every deviation decided |
| 7. Merge | Engineer | Pull request opens with the plan summary, findings history and deviation list attached | Merge |
| 8. Verify | Test agent | On deploy, checks each acceptance criterion through the API and the web app and records evidence | Every criterion passes |

**Features that span repositories.** A feature can involve several repositories, and it still has one plan and one approval. Every stage from planning to implementation review runs once for the whole feature, through a cross-repository orchestrator that calls each repository's own orchestrator for that stage. Each repository gets its own branch and pull request, so such a feature ends in one pull request per repository. Verification runs once every repository's change is live. The sections below mark where this changes a stage, and a feature with one repository behaves exactly as described.

The plan revision is frozen at approval. Because every decision is settled during planning, implementation runs straight through without stopping to ask. If the agent still meets an undecided point, that is a defect in the plan: the run stops and returns to planning instead of guessing.

Agents do not always stop when they should. They often make the call and keep going, so implementation review also compares the diff with the plan and reports every deviation and every extra for the engineer to decide. Review and triage covers how.

**Amending an approved plan.** An approved plan changes only through an amendment: a new revision made from the approved one and reviewed as a diff against it. Three things open one: a run that stops on an undecided point, an engineer who chooses Replan on a deviation, and a staleness warning the engineer acts on. How much review an amendment gets depends on which sections changed.

| Amendment | What changed | Plan review | Peer approval |
| --- | --- | --- | --- |
| Decision only | An entry under Decisions is added or changed. No step, "done when" line, constraint or test plan row changes | None | None. Approvers are notified and can reopen it |
| Approach | Steps, files or tests change, and every "done when" line and constraint stays as approved | Changed sections only | None. Approvers are notified with the diff and can reopen it |
| Scope | A "done when" line, a constraint or the goal changes, a step is added or removed, or a named path such as migrations is touched | Changed sections only | One original approver approves the diff |

The app sets the level from which sections changed. The engineer can raise a level but not lower it. Review and approval cover the diff against the approved revision, never the whole plan again.

After an amendment, implementation resumes on the same branch from the amended revision. Work that still matches the plan is kept, changed steps are redone, and implementation review checks the whole diff against the amended revision.

## Plan workspace

The plan workspace is where the product has to stand out: making a strong plan should be mostly clicking and choosing, with typing kept for intent.

**One tab per feature.** Work starts by creating a feature, which opens its own tab, the way coding apps keep a tab per project. Everything for that feature lives under the tab: its pre-planning tasks, context files, plan, thread, runs and evidence. Tasks run in the background, so an engineer can start one and switch tabs, and each tab shows its status.

**Starting a feature.** A new feature begins with a short intake form that asks for very little but accepts a lot, and submitting it starts the context work straight away.

| Field | Required | What it does |
| --- | --- | --- |
| Description | Yes, any length | Becomes the feature brief and scopes the exploration. A full brain dump is encouraged: the more the engineer says up front, the better the context and the fewer questions later |
| Ticket link | No | The ticket's contents are pulled into the brief |
| Documents, screenshots, links | No | Attached to the brief |
| Repositories | Yes, shown only when more than one repository is configured | The repositories the feature touches, or **Not sure**. See below |
| Explore the codebase | Ticked by default | Starts an exploration task on submit, one per selected repository |
| Research topics | No, one line per topic | Starts one research task per topic |

On submit, the exploration and every research task run in parallel in the background. When they finish, the feature is marked **plan ready**: the engineer looks over the context files, unticks anything that missed, and clicks Start planning. Planning never starts on its own. The engineer can start before every task has finished, and a failed task does not block the plan.

**Choosing repositories.** With one configured repository the picker is hidden and that repository is used. With several, the engineer ticks the ones involved. If they pick **Not sure**, a quick exploration runs across every configured repository, guided by each one's description, and proposes which are involved. The engineer confirms the list before the full exploration runs. Repositories can be added or removed while the plan is a draft. After approval, adding one is a scope amendment, because it adds steps.

**Connecting Jira.** A ticket link is only useful if the app can read the ticket, so Jira is connected through its MCP server. The connection flow appears only when an engineer supplies a ticket link and Jira access is not set up yet: the app adds the MCP server to their agent CLI and walks them through sign-in, then reads the ticket. Atlassian's official [Rovo MCP Server](https://github.com/atlassian/atlassian-mcp-server) is hosted, signs in through the browser with OAuth, and covers Jira Cloud only, so self-hosted Jira needs a different server.

&#91;embedded content: one feature tab · 3 tasks, 3 context files, 1 plan\]

**Pre-planning tasks** load up context before any plan is written. Each task is an agent session with a goal, and it ends in one context file.

| Task | What the agent does | Context file it produces |
| --- | --- | --- |
| Intake | Reads the description, ticket and attachments the engineer submitted | The feature brief |
| Explore the codebase | Reads each selected repo through Claude Code or Codex to find how the affected area works today. One task and one context file per repo | Findings, with the files and functions involved, the open questions it could not settle, and risk flags such as performance or scale |
| Research | Looks into one requested topic outside the repo, such as a library, an API or an approach | A summary with its sources |

**Context files** are short documents the engineer can open, edit, rename or delete. A checkbox on each decides whether it feeds the plan, and the plan records which files it was built from, so reviewers can see its inputs. Context files belong to the feature and are discarded with it; they are not committed to the repo.

Claude Code and Codex each have a non-interactive mode with structured output, so one task view can serve both ([overview](https://dev.to/hassann/top-cli-tools-for-ai-agents-2j4c)).

**The planning session.** Planning is a guided conversation, and its one job is to leave nothing undecided. Every question that could stop an implementer is asked and answered here, so implementation can always run straight through.

&#91;embedded content: planning session · 5 steps, 1 loop\]

1. **Read context.** The planning agent reads the ticked context files and lists every decision the feature needs and every gap it found.
2. **Decide or ask.** It settles what a senior engineer would settle alone, and asks the engineer about the rest, one question at a time, as choices with a recommended option. The engineer clicks an answer or types their own.
3. **Draft.** It writes the plan section by section from those decisions and the team template, and the engineer adjusts sections with the section actions.
4. **Check for blockers.** It scans the draft for anything an implementer could not act on: an open question, a vague step, a step with no "done when" line, a line no test covers, a dependency nobody has confirmed.
5. **Repeat or finish.** Each blocker is decided or becomes a new question. The plan can be marked ready only when the check comes back clean.

**When the agent asks.** The planning agent is guided to behave as a senior engineer: it makes the calls a senior engineer would make without checking, and saves questions for what only the engineer can answer.

| Situation | What the agent does |
| --- | --- |
| A clear best practice, or one of the repo's rule skills, settles it | Decides, and records the decision and its reason in the plan |
| Several reasonable options with real trade-offs and no clear best choice | Asks, with a recommended option |
| Business or use-case context is needed | Asks |

The decisions the agent makes on its own are listed in the plan, so the engineer and reviewers can see them and overrule any one.

This workflow lives in the plan orchestrator, so a team can tune how its plans are questioned and written. HumanLayer found that when planning ran as one prompt, the step where the agent raises design decisions [was often skipped](https://www.zenml.io/llmops-database/evolution-from-rpi-to-crispy-multi-stage-workflow-for-production-coding-agents), which is why the questioning is its own enforced stage here.

**What a plan contains.** A plan says what needs to be done and how it will be proven, in five sections, with a sixth that appears only when needed. There is no separate spec: requirements fold into the steps.

| Section | What it holds | Shown |
| --- | --- | --- |
| Goal | One or two lines on what the feature is for | Always |
| Steps | The work, in order. Each step names its files and has a plain "done when" line | Always |
| Decisions | What was decided, by the agent or the engineer, and why. Anything deliberately left out is recorded here | Always |
| Constraints | Performance, scale or other limits the work must meet, each with a target and a check | Only when flagged |
| Test plan | Which unit, integration and end-to-end tests cover each "done when" line | Always |
| Verification | How the result is proven: automated commands, agent-run checks through the API and Playwright, and checks only a person can make | Always |

**Plans across repositories.** When a feature involves more than one repository, the plan is still one document. Its Steps are grouped by repository, and within each repository by phase. A phase is a set of steps that must land before the next begins. Phases can also order work across repositories, such as an API change before the client that uses it. Each repository's part is written with that repository's own plan orchestrator and rule skills, so its steps follow its own standards. Decisions that cross repositories, such as an API contract, are recorded once under Decisions and referenced from every step they affect. The test plan and verification rows are tagged with their repository. A single-repository plan has no grouping, and reads as before.

Each step's "done when" line is its acceptance criterion, written as one plain sentence. It is what the review agent checks the code against and what the Verify stage tests, so the rest of this document calls these lines acceptance criteria.

**The test plan is a coverage grid.** It has one row per "done when" line and a column each for unit, integration, end to end, agent check and human check. The agent fills it in from the repo's testing rules and the engineer changes ticks where they disagree. A row with nothing ticked is a gap, and the blocker check stops on it. Splitting verification into what an agent can run and what needs a person follows [HumanLayer's plan template](https://skills.sh/ferueda/agent-skills/create-plan).

**Constraints without extra work for the engineer.** Performance and scalability needs are not asked about by default. Three signals raise them:

| Signal | Where it comes from | What happens |
| --- | --- | --- |
| Standing rules | The repo's performance rule skill, set once at repository setup | Applied to every plan without a question |
| Risk flags | Exploration finds the feature touches a high-traffic path, a large table, an unbounded list or a new query | The Constraints section appears with proposed targets |
| Intake wording | Terms such as bulk, import, export, search, report or real time | The Constraints section appears with proposed targets |

When the section appears, the agent proposes targets from the standing rules and asks only for what it cannot know, usually the expected volume, as one multiple-choice question that includes "not sure". On "not sure" it applies a cautious default and records the assumption under Decisions. Every constraint gets its own row in the test plan, so it is verified like any other line. The same mechanism can later cover security, accessibility and data migration.

**How the plan is displayed**

- **Section rail with status.** Each section shows complete, has an open question, or has findings.
- **Cards, not prose.** Steps are cards the engineer reorders, edits or hands to the agent to revise, and the test plan is a grid of checkboxes.
- **Coverage at a glance.** Each step shows which tests and checks cover it, and an uncovered step is flagged.
- **Stale markers.** Editing a step flags the tests and checks that depend on it, so nothing silently goes out of date.
- **Revision diff.** Each new revision shows what was added and removed since the last, as [Plannotator](https://docs.plannotator.ai/open-source/workflows/plan-review.md) does for agent plans.

**When main moves under the plan.** Exploration records the commit of the main branch it ran against, and the plan carries that as its base commit, one per repository when the feature spans several. Each time a repository's main changes, the app compares the files changed since the base commit with the files named in the plan's steps and in its exploration findings.

| Main since the base commit | What the engineer sees |
| --- | --- |
| No overlap with the plan's files | A quiet count of how many commits behind the plan is |
| Overlap with the plan's files | A warning on the feature tab and the plan, listing the overlapping files and the commits that changed them |

By default the warning blocks nothing. The engineer can dismiss it, or click Replan: exploration reruns on the overlapping files and the planning agent proposes what to change. Before approval that produces a new revision, and after approval it goes through the amendment path. The check runs again when the plan is marked ready, when a peer opens it to approve, and when implementation starts, so approvers see the same warning.

**Plan features**

| Feature | What the engineer does | First version |
| --- | --- | --- |
| Feature tabs | Creates a feature through a short intake form and switches between features, each showing its own status | Yes |
| Pre-planning tasks | Gets exploration and requested research started on submit, in parallel, and can add more tasks later | Yes |
| Context files | Opens, edits and ticks the files that feed the plan | Yes |
| Structured plan | Works in sections: goal, steps, decisions, test plan and verification, with constraints added when flagged | Yes |
| Clarifying questions | Answers the planner's questions by picking options instead of typing | Yes |
| Section actions | Clicks to expand, simplify or regenerate one section without touching the rest | Yes |
| Inline findings | Sees review findings against the lines they refer to, with accept and reject buttons | Yes |
| Readiness checklist | Sees what is missing before review: criteria present, steps testable, open questions answered | Yes |
| Revision history | Compares any two revisions side by side | Yes |
| Plan thread | Asks or answers questions about the plan in the open | Yes |
| Staleness warning | Sees when main has changed files the plan touches, and replans if they choose | Yes |
| Amendments | Reopens an approved plan, changes it, and sees what review the change needs | Yes |
| Alternative approaches | Asks for a second approach and picks between the two | Later |
| Epics | Groups several features that share context files | Later |

**The plan thread.** Every plan has one open thread. Anyone with access can ask a question, and an agent that holds the plan, its context files and read access to the repo answers where all reviewers can see it. A button turns an answer into a suggested plan change for the author to accept. The thread stays with the plan's history, so later reviewers see what was already asked.

## Skill orchestration

Skills live in the repository being worked on, beside the code, and four orchestrator skills drive the workflow.

| Orchestrator | Runs at | What it holds |
| --- | --- | --- |
| Plan orchestrator | Planning | The guided planning workflow and its principles for when to ask, how the team wants plans written, the plan template, and which rule skills to consult |
| Plan review orchestrator | Plan review | What to check a plan for, including anything left undecided, and how to write findings |
| Implementation orchestrator | Implementation | How to work from an approved plan, including testing expectations and how to log any departure from it |
| Implementation review orchestrator | Implementation review | What to check a diff for against the plan and the rule skills, including deviations and extras |

**Cross-repository orchestrators.** When a feature spans several repositories, four more orchestrators run in place of the single-repository ones: a cross-repository plan orchestrator, plan review orchestrator, implementation orchestrator and implementation review orchestrator. Each mirrors its single-repository counterpart, and none holds standards of its own. They know the configured repositories and what each is for, and they reach into each one to run that repository's orchestrator for the same stage.

| Orchestrator | What it adds across repositories |
| --- | --- |
| Plan | Has each repository contribute its part of the plan, orders work across repositories and records the contracts between them |
| Plan review | Reviews each part with its repository's plan review orchestrator, then checks the parts fit together |
| Implementation | Runs each repository's implementation in the order the plan's phases set, and logs any departure with its repository |
| Implementation review | Reviews each repository's diff with its own orchestrator, then checks the changes still match the contracts in the plan |

No repository leads: each contributes its own part. These orchestrators belong to the set of configured repositories rather than to any one of them, so the app keeps them and writes them at setup from the repository descriptions. The engineer can edit them.

**Rule skills** hold the codebase's standards: architecture, best practices, migrations, performance, UI rules. Each orchestrator is told which rule skills exist and invokes the ones the task needs, at the point it needs them.

**How a stage runs**

1. The runner checks out the feature branch, and the skills come with it. For a multi-repository feature it checks out every involved repository.
2. The stage's orchestrator skill is loaded as the agent's instructions.
3. The orchestrator decides which rule skills to invoke and when.
4. The run logs the commit and each skill that loaded.

Because skills sit in the repo, a skill change is reviewed like code, and every run uses the skills as they stand on its branch.

**One format, two agents.** Claude Code and Codex read the same SKILL.md format but look in different folders: Codex reads `.agents/skills/` and Claude Code reads only `.claude/skills/` ([comparison](https://mcp.directory/blog/cross-agent-skills-cursor-codex-cline-antigravity-gemini-mastra-portability)). Claude Code had no support for `.agents/skills/` as of October 2026 ([issue](https://github.com/anthropics/claude-code/issues/31005)). Skills are written once in `.agents/skills/`, the canonical folder, and mirrored one way to `.claude/skills/`. The mirror is a copy, not a symlink, because symlinks need extra permissions on Windows and Git checks them out as plain files there by default.

**Keeping the mirror in step.** The local runner ships two commands, so any repository can use them without adopting Plangineer's own tooling.

- **`skills sync`** copies every file from the canonical folder to the mirror, normalizes line endings to LF, deletes mirror files with no source, refuses symlinks and writes only files that changed. An agent that writes or edits a skill writes only the canonical copy and then runs it. It never reads or writes the mirror, so the copy costs no tokens.
- **`skills check`** writes nothing. It fails on any missing, changed or stray mirror file, naming each one and the fix: edit the canonical copy, then sync. Differences only in line endings are not drift. Setup's pull request adds it to the repository's CI and marks the mirror as generated in `.gitattributes`, so it collapses in pull request diffs.
- **Before every run** the runner runs `skills check` on its checkout. A drifted checkout fails the run instead of giving the two CLIs different skills.

The check exists because Claude Code shows the mirror's path when it loads a skill, so the likeliest mistake is an agent or engineer editing the mirror. Without the check, the next sync would silently overwrite that edit. The same one-way mirror with a check mode is a pattern other projects already use ([example](https://github.com/RossGraeber/OAC/pull/237)).

Step 4 is a log line, not an audit system. It costs almost nothing now and means later skill auditing needs no rework.

## Repository setup

Repositories are the first thing configured, because everything else depends on them. Setup takes each repository from whatever agent guidance it has today to four orchestrators and a full set of rule skills, through checklists the engineer confirms. It runs once per repository, each with its own pull request, and repositories can be added at any time. A feature cannot start until at least one repository has finished setup.

0. **Configure repositories.** The engineer adds every repository the team works in, each with a short description such as "backend API" or "web client". The descriptions are what the app uses to propose repositories when an engineer is not sure, and to write the cross-repository orchestrators. Steps 1 to 6 below then run for each repository. Once two or more are configured, the app writes the four cross-repository orchestrators.

1. **Connect.** The engineer picks a repository.
2. **Detect.** A scan lists the skills, rule files and agent instruction files already present, looking in the folders each agent uses.
3. **Recommend.** The scan compares what it found with a baseline catalog of skills most codebases need, adjusted to the repo, such as UI rules only where there is a frontend.
4. **Choose.** The engineer sees three checklists: existing skills to reuse, recommended skills to add, and the four orchestrators. They tick what they want.
5. **Generate.** The app drafts each chosen skill from the codebase to a standard structure, and writes the orchestrators to reference both existing and new skills.
6. **Review.** Everything arrives as one pull request, so the team reviews generated skills like any other change.

Setup never rewrites an existing skill. The orchestrators reference existing skills as they are. An existing skill found only under `.claude/skills/` is moved unchanged to `.agents/skills/` in the setup pull request, and the mirror is generated from there.

**Two specifications this depends on,** both written in Phase 0:

- **[Skill specification](skill-specification.md):** what each kind of skill must contain and how it is structured.
- **[Baseline catalog](baseline-catalog.md):** the skills setup recommends for any codebase, and the signal in a repo that triggers each one.

## Review and triage

Every review passes three filters before anything is fixed: a reviewing agent raises findings, the authoring model confirms them, and the team's triage rules decide what to act on.

&#91;embedded content: review pipeline · 3 filters, then a re-review decision\]

1. **Review.** A reviewing agent reads the plan or the diff and writes findings. Running it on a different model from the author is recommended, and is the default the app suggests, but it is not required: each repository chooses the CLI and model for every role.
2. **Confirm.** Each finding goes back to the model that wrote the work, which marks it confirmed or disputed and gives its reason.
3. **Apply rules.** Triage rules sort the confirmed findings into act, ask or skip.
4. **Fix.** The authoring agent fixes the findings the `findings` setting selects.
5. **Assess.** An agent judges how significant that round was and recommends whether another review is needed. The `rounds` setting decides whether one runs.

**Triage rules** are guidance kept in the repo beside the review orchestrators. For example: always act when an acceptance criterion is broken, skip style points the linter allows, ask when a fix changes a public interface.

**Workflow settings** decide who picks the fixes and how many rounds run. An admin sets them per repository on the repository's settings card in the app. Plan review and implementation review each have their own `findings` and `rounds`, so a team can fix every plan finding automatically and still pick code fixes by hand.

| Setting | Applies to | Value | What happens |
| --- | --- | --- | --- |
| `planCheckIn` | Planning | `pause` | After drafting, planning stops and the engineer chooses between running plan review and changing the plan. The default |
| | | `skip` | The engineer sees the plan summary, and plan review starts without a question |
| `findings` | Each review | `ask` | The engineer picks which confirmed findings to fix, with each triage rule's outcome already selected. The default |
| | | `fix_all` | The authoring agent applies the recommended action to every confirmed finding, including Accept or Revert for each deviation and extra, and asks nothing |
| `rounds` | Each review | `ask`, `fixed` or `adaptive` | See Deciding on another review |

Every fix under `fix_all` lands as its own commit, so it can be reverted with one click. Disputed findings are kept and shown collapsed, and an engineer can overrule a dispute.

**Deciding on another review.** After the fixes from a round are in, an agent assesses that round: how many findings were confirmed, how serious they were, and how much the fixes changed. It rates the round significant or minor and recommends whether another review is worth running, with a one-line reason. The `rounds` setting then decides what happens. Its round count N is 1 to 5.

| `rounds` value | What happens |
| --- | --- |
| `ask` | The engineer sees the agent's recommendation and chooses to review again or move on, as many times as they want. The default |
| `fixed`, N | N rounds run in all without asking. Review stops early after a round with no confirmed findings |
| `adaptive`, maximum N | Another round starts without asking whenever the agent recommends one, up to N rounds in all |

**Deviations from the plan.** Implementation review checks conformance as well as quality. It matches every step and decision in the plan to the diff, and every change in the diff back to a step. Anything that does not match is raised as a finding of one of two kinds.

| Kind | What it means | Example |
| --- | --- | --- |
| Deviation | The plan said one thing and the code does another, or a step was not built | The plan names a queue and the code polls on a timer |
| Extra | The diff contains something no step asked for | A new config flag, a refactor of a neighbouring module, an added dependency |

Two sources feed the check. The implementation orchestrator has the implementer log each departure as it makes it, with its reason. The reviewer then finds departures on its own from the plan and the diff. A departure the reviewer found and the implementer did not log is marked unreported.

For a multi-repository feature, this check runs per repository against that repository's part of the plan, then once more across repositories for the contracts between them. Each finding records its repository.

Deviations and extras go to the engineer whenever implementation review's `findings` setting is `ask`. Triage rules cannot skip or accept them. The one exception is an engineer-set `fix_all`: the authoring agent then applies the confirm step's recommended Accept or Revert to each one. Each one gets one of three decisions:

- **Accept.** The code stays, and the choice is recorded as an amendment at the level the change calls for, usually decision only, so the plan matches what was built.
- **Revert.** The implementer changes the code back to what the plan says, or removes the extra.
- **Replan.** The plan was wrong, and the feature goes through the amendment path.

**Auditing them.** The plan audit lists every step of the approved plan as built as planned, deviated or not built, followed by every extra with its files and lines. Each row shows who decided it and why. The same list is attached to the pull request, so the engineer who merges sees what differs from the plan they approved without reading the whole diff.

**What a finding holds**

| Field | Contents |
| --- | --- |
| Location | A line range in the plan, or a file and lines in the diff |
| Claim | What is wrong, in one or two sentences |
| Kind | Defect, deviation or extra. A deviation or an extra also names the plan step it relates to and whether the implementer logged it |
| Severity | Blocker, should fix, or nit |
| Suggested change | What the reviewer would do instead |
| Source skill | The rule skill the reviewer says it applied, if any |
| Author verdict | Confirmed or disputed by the authoring model, with its reason |
| Rule outcome | Act, ask or skip, and which triage rule decided |
| Decision | What happened in the end: fixed, rejected or deferred, and by whom |

Recording the verdict, rule outcome and decision for every finding is what lets a team move to `fix_all` with evidence instead of a guess.

## Verification

When the change reaches an environment, a test agent checks each acceptance criterion in the plan and attaches evidence for every verdict.

| Check type | How the agent runs it | Evidence kept |
| --- | --- | --- |
| API | Calls the endpoints from its shell | Request and response log |
| Web app | Drives a browser with Playwright CLI commands | Screenshots and page snapshots |

**How a verification run works**

1. A deploy webhook tells the app which build is live and where. For a multi-repository feature, verification starts once every involved repository's change is live.
2. The test agent reads the plan's acceptance criteria and writes one or more checks for each.
3. It runs the checks and gives each criterion a verdict: pass, fail, or blocked when it could not be tested.
4. The report goes to the author. A failure returns the feature to the author with the evidence attached.

The test agent is a separate run from the implementer. It sees the plan and the environment, not the implementation session, so it tests what was promised and not what was built.

**Why Playwright CLI.** Microsoft built it for coding agents that already have a shell and a filesystem. One independent benchmark measured about 27,000 tokens for a browser task over the CLI against about 114,000 over the Playwright MCP server ([comparison](https://bug0.com/blog/playwright-cli-vs-playwright-mcp-ai-browser-testing-2026)).

**What each environment must provide:** a base URL, test accounts held as runner secrets, and seed data that is safe to change.

This is one-off checking of a feature. Generating a lasting regression suite is a separate job and not part of this version.

## Architecture

&#91;embedded content: system architecture · 3 components, 4 external systems\]

The web app talks only to the control plane. The control plane queues one job per agent run, and each runner streams events back as it works.

- **Runners hold no state.** Each one starts from a fresh checkout of the feature branch, which brings the skills with it, and is thrown away when the run ends.
- **A runner can sit in two places.** A local runner on the engineer's machine can serve every stage with their own CLI login, which is how the product runs on a subscription. Hosted runners serve implementation, review and verification in the background for teams that want runs to continue with the laptop closed.
- **One adapter per agent CLI.** Claude Code and Codex each run non-interactively and emit structured output. The adapter turns that into run events for the feature tab and the timeline. The Claude Code adapter comes first; Codex is added once the workflow runs end to end on Claude Code.
- **Webhooks drive the gates.** The Git host reports build results, merges and pushes to main; the deploy pipeline reports which build is live, which starts verification.
- **The first hosted runners can be CI jobs.** That avoids building sandbox infrastructure before the workflow is proven.
- **The web app is one client of the API.** Everything the UI does goes through the same API a mobile app will use, and the control plane emits the events that become notifications.

**The local runner.** The local runner is a small Node program the engineer installs from npm, and it is a deliverable of its own in Phase 1.

- **Pairing.** The engineer signs it in to the app once. It then keeps an outbound connection to the control plane, so no inbound port is opened on the machine.
- **Running a job.** It receives a job, creates a worktree for that feature of each repository the job involves, starts the installed CLI in non-interactive mode, and streams the events back.
- **Sign-in.** It runs the CLI exactly as the vendor ships it, under the login the engineer already has. It never reads, copies or uploads that login.
- **Platforms.** It runs on Windows, macOS and Linux, and is tested on all three for every release.
- **Limits.** It runs a set number of jobs at once, queues the rest, and reports when the machine is offline or a plan limit is reached.
- **Updates.** It updates through npm like any other package, and reports which CLI versions are installed.
- **Skills mirror.** It provides `skills sync` and `skills check`, which keep `.claude/skills/` an exact copy of `.agents/skills/` (see Skill orchestration).

**Running on a subscription.** Each engineer's own Claude or ChatGPT plan can pay for their runs, and the local runner is the path both vendors support. Hosted runs are possible on each, on terms that differ by vendor. Checked October 6, 2026.

| CLI | Local runner, engineer's own login | Hosted runner |
| --- | --- | --- |
| Claude Code | Supported. `claude -p` draws on the engineer's plan limits. Anthropic paused a planned move of this usage to a separate monthly credit on June 15, 2026, and says it will give notice before any change ([help article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)) | Allowed only where each engineer signs in themselves, through Anthropic's own flow, to an unmodified Claude Code, and the usage bills to them. The app may not collect, store or relay Claude logins. Developers building products are pointed to API keys ([terms](https://code.claude.com/docs/en/legal-and-compliance)) |
| Codex | Supported. `codex exec` uses the cached ChatGPT sign-in ([authentication](https://learn.chatgpt.com/docs/auth)) | OpenAI recommends an API key for automation. A ChatGPT login can run on a trusted private runner, with one `auth.json` per runner or serialized job stream, and Enterprise workspaces can issue access tokens ([CI/CD guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth)) |

OpenAI also runs a [Sign in with ChatGPT program](https://developers.openai.com/siwc/token-sharing-open-source) that lets open-source and locally hosted apps use a person's ChatGPT plan directly, with paid or remotely hosted apps by application.

What this means for the design:

- **Local first.** Every stage can run on the local runner, so a team with no API keys can use the whole workflow. Where each role runs is a repository setting.
- **Hosted runs sign in per engineer or per team.** A hosted run uses either the feature owner's own sign-in, on the terms above, or a team API key or service account.
- **No silent fallback.** A run never switches from a subscription login to an API key on its own. Each run records which sign-in it used, and the timeline shows it.
- **Plan limits are shared.** Parallel pre-planning tasks and several roles draw on one engineer's plan, so the runner queues work when a limit is reached. Review on a different model needs the engineer to hold a plan with a second vendor, or the team to supply a key for that role.
- **Terms change.** Sign-in mode is set per role, so a vendor change means changing a setting, not the architecture.
- **Open source keeps the app out of the login path.** Each team self-hosts its own deployment, and the app never offers, holds or relays a vendor login; it only starts the CLI the engineer installed and signed in to. Anyone who runs a deployment as a service for others takes on the vendors' commercial terms themselves. Two points still need Anthropic's confirmation before the hosted path is built: hosted Claude Code under an engineer's own plan, and whether a third-party runner starting the engineer's installed `claude` counts as third-party app usage of their plan.

## Data model

The app keeps fifteen kinds of record, and the plan revision is the one everything else points at.

| Record | Holds | Notes |
| --- | --- | --- |
| User | Name, email, GitHub identity, role (admin or member), notification preferences | One deployment serves one team, so there is no organization record and the role is the membership. Admins configure repositories, orchestrators and workflow settings |
| Runner | Owner, kind (local or hosted), name, hashed pairing token, installed CLI versions, concurrency limit, last heartbeat, status | A local runner belongs to one engineer, is paired once and can be revoked. Each run records the runner that served it |
| Feature | Title, description, ticket link, repositories, author, current state such as plan ready | One per change, shown as a tab |
| Pre-planning task | Type, repository for exploration, agent CLI used, goal, the commit it ran against, transcript, status | Produces one context file |
| Context file | Title, content, the task it came from, whether it is ticked | Belongs to the feature and is discarded with it |
| Plan revision | Full plan text, acceptance criteria, the context files it was built from, base commit per repository, revision number, and for an amendment its level | Never edited in place; each round of edits makes a new one, and one is marked approved |
| Thread message | A question or answer on a plan, its author, any suggested change it produced | The plan thread |
| Run | Stage, repository where the stage is per repository, agent and model, runner and sign-in used, commit, skills loaded, status, cost, event log | One per agent execution |
| Finding | The fields listed under Review and triage | Belongs to a review run and points at a plan revision or a diff |
| Approval | Reviewer, plan revision, verdict | The peer approval |
| Verification result | Criterion, verdict, links to evidence | One per acceptance criterion in each verification run |
| Repository settings | Name, description, agent and model per role, where each role runs and how it signs in, workflow settings: `planCheckIn`, and `findings` and `rounds` for each review | One per repository. Planning and plan review of a multi-repository feature use the roles set for the cross-repository orchestrators |
| Cross-repository orchestrator | Stage, content, revision number, author of each revision, agent and model per role | One per stage for the set of configured repositories. Regenerated from the repository descriptions at setup, edited by engineers, and versioned like a plan so each run records which revision it used |
| Staleness dismissal | Plan revision, repository, the main commit it was dismissed at, the overlapping files, who dismissed it | Silences the warning for overlaps up to that commit. A later commit that touches a plan file raises it again |
| Notification | Recipient, kind such as decision needed, approval requested or run failed, the record it points at, read state | Feeds the in-app inbox now and push notifications later. Created by the control plane from the same events the timeline shows |

**Where each thing lives**

- Users, runners, plans, threads, findings, run history, cross-repository orchestrators and notifications: the app's database.
- Code, skills, orchestrators and triage rules: each repository, on the Git host. The cross-repository orchestrators are kept by the app.
- Evidence files: object storage, linked from the verification result.

When implementation starts, the runner writes the approved plan revision into the agent's workspace. It is not committed to the main branch, which keeps plans out of the codebase.

## App screens

Engineers work in eight views, and the plan workspace is where most of the time goes.

| Screen | What the engineer does there |
| --- | --- |
| Repository setup | Adds and describes repositories, then for each one ticks which detected and recommended skills to use, opens its setup pull request and sets its workflow settings |
| Feature tab | Submits the intake for a new feature and picks its repositories, watches its tasks run, manages the context files, and starts planning once it is plan ready |
| Plan workspace | Builds and revises the plan with section actions, inline findings, revision history and the plan thread |
| Review queue | Sees plans waiting for their approval and findings waiting for their decision |
| Triage | Works through the findings that need a person |
| Plan audit | Compares what was built with the approved plan step by step, and accepts, reverts or replans each deviation and extra |
| Run timeline | Watches a feature move through the stages live: current stage, round number, skills loaded, cost so far |
| Verification report | Reads each acceptance criterion with its verdict and opens the screenshots or request logs behind it |

**Designing for mobile.** A mobile app is planned for later, so every screen is designed to work at phone width from the first version.

&#91;embedded content: plan workspace layout · desktop and phone\]

On desktop the findings sit beside the plan. On a phone the same finding cards rise from a sheet at the bottom, one at a time.

- **One column first.** Each screen is designed as a phone-width column, and desktop adds side panels on top of it.
- **One decision per card.** Triage, approvals and clarifying questions are cards with two or three buttons, which suits a thumb as well as a mouse.
- **Plans are blocks, not one long page.** Sections and steps are cards the engineer expands, reorders and acts on one at a time.
- **Every action has a button.** Nothing depends on hover, right-click or a keyboard shortcut.
- **Work never depends on an open tab.** Runs continue in the background, and notifications bring the engineer back when a decision is needed.

| Screen | On a phone | Notes |
| --- | --- | --- |
| Review queue | Full | The natural home screen |
| Triage | Full | One finding per card |
| Plan audit | Full | One deviation or extra per card |
| Plan thread and peer approval | Full | Reads like a chat |
| Run timeline | Full | Live stage, round and cost |
| Verification report | Full | Screenshots open full screen |
| Feature tabs and pre-planning tasks | Full, with a hosted runner | Tabs become a list of features; a phone has no local runner |
| Plan workspace | Read, comment and section actions | Long drafting stays easier on desktop |
| Repository setup | Works, rarely needed | Checklists fit a phone |

The web app is responsive from Phase 1, so engineers can approve and triage from a phone browser before any app exists. One consequence for the architecture: a phone has no local runner, so exploring or planning from mobile needs a hosted runner.

## Build plan

&#91;embedded content: build roadmap · 5 phases, 4 exit gates\]

Each diamond is an exit gate: the next phase starts only when its condition is met. Phase 0 needs no new software, so it tests the workflow before any app is paid for.

| Phase | Scope | Exit gate | Rough size |
| --- | --- | --- | --- |
| 0. Prove the loop | Hand-write the four orchestrators and the triage rules in one repo. Run the full loop from the command line, including the confirm step and the deviation check. Write the skill specification and the baseline catalog | Engineers judge the reviews useful on 3 to 5 real features, and the finding format and skill specification are settled | 2 to 3 weeks |
| 1. Setup and plan | Repository configuration and per-repository setup, the four cross-repository orchestrators, the feature intake with repository selection and the Jira connection flow, feature tabs with parallel pre-planning tasks and context files on Claude Code, the local runner on the engineer's Claude Code login, GitHub sign-in, the plan workspace with staleness warnings, the plan review pipeline with the workflow settings, the plan thread, peer approval and amendments, all responsive and built on the same API a mobile app will use | Plans for real features are approved through the app, with the local runner working on Windows, macOS and Linux | 7 to 10 weeks |
| 2. Automated runs | The Codex adapter, so review can run on a different model, run dispatch and hosted runners, isolated workspaces, pull request creation, the implementation review pipeline with deviation detection, the plan audit, and the run timeline | An approved plan becomes a reviewed pull request with nobody driving the agent | 5 to 7 weeks |
| 3. Verification | Deploy webhook, API checks, Playwright CLI web checks, evidence storage and the report | Every feature gets an evidence report | 2 to 3 weeks |
| 4. Auto-fix and rollout | Revertible fix commits, roles and permissions, push notifications, cost and cycle-time metrics | A team runs implementation review with `findings` at `fix_all` and rarely reverts a fix | 3 to 4 weeks |

Sizes are rough estimates for one or two engineers, 19 to 27 weeks in total, and should be re-cut after Phase 0.

**Left for later:** skill auditing and line-level provenance, testing of mobile apps, alternative approaches in the plan workspace, the Cursor CLI, and the mobile app itself.

## Risks

The two risks most likely to sink adoption are noisy reviews and slow plan approval; the rest are engineering risks with known answers.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Review noise | If most findings are wrong or trivial, engineers stop reading them | The confirm step removes findings the author can rebut; triage rules skip the rest; accept rate shown per repository |
| An automatic fix is wrong | A bad fix applied without review erodes trust in the whole system | Start from the `ask` findings setting; every fix under `fix_all` is its own revertible commit; each review has its own `findings` setting, so a team can keep picking code fixes by hand |
| Plan approval becomes the bottleneck | Review effort moves rather than shrinks. One [study of about 22,000 developers](https://briefhq.ai/blog/why-spec-driven-development-isnt-enough/) found 98% more merged pull requests and 91% more review time | Trivial changes skip peer approval; the plan thread answers questions without a meeting; the queue shows how long each plan has waited |
| Generated skills are generic | Setup that writes bland skills adds noise instead of standards | Skills are drafted from the repo's own code to the skill specification, and arrive as a pull request the team edits |
| Platform differences break the runner | Engineers run Windows, macOS and Linux, and paths, shells, line endings, process control and CLI install shapes differ between them. Plangineer is developed on Windows, so Windows-only assumptions are the likeliest to slip in | No shell scripts; platform-neutral paths and line endings; every check runs in CI on all three systems |
| Two agent CLIs behave differently | Output formats, permissions and skill folders differ between Claude Code and Codex | One adapter per CLI; one canonical skills folder mirrored to the other; start with Claude Code and add Codex once the workflow runs end to end |
| Verification has nothing to test against | Without test accounts and safe seed data, every check comes back blocked | Environment checklist completed before Phase 3; start with one project |
| Runners hold real access | An agent that runs code has repository and environment credentials | Isolated workspace per run, short-lived scoped credentials, no production secrets |
| Cost per feature | Each feature uses several model runs across four roles, and the confirm step adds more | Cost recorded per run and shown on the timeline; under the `ask` rounds setting the engineer approves each extra review, and `adaptive` stops at its maximum of at most 5 rounds |
| The runner outgrows the product | Companies such as Stripe and Ramp [built whole platforms](https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect) for background agents | Start on CI runners and defer dedicated infrastructure until usage demands it |
| Multi-repository work drifts apart | Changes in separate repositories can each pass review and still not fit together, such as an API and its client | One plan with cross-repository phases and contracts recorded under Decisions; verification waits until every repository's change is live |
| Planning feels like an interrogation | A long run of questions wears engineers down, and they start clicking through without thinking | The agent acts as a senior engineer and decides wherever a best practice is clear, asking only about real trade-offs and business context; a fuller intake means fewer questions; each question comes with a recommended option |
| The agent guesses instead of stopping | An unplanned choice ships under a plan that was approved without it | The implementer logs each departure; the reviewer checks the diff against the plan on its own; every deviation and extra needs an engineer's decision unless `fix_all` is set, and appears in the plan audit and on the pull request |
| Amendments reopen the approval bottleneck | If every change after approval needs a full review, engineers stop amending and let deviations stand | Three amendment levels set by which sections changed; review covers the diff only; only a scope change needs an approver |
| Subscription terms change | Vendors decide how a plan login may be used for headless and hosted runs. Anthropic announced a change for June 2026 and then paused it, and its plan limits assume ordinary individual use | The local runner under the engineer's own login is the default; sign-in mode is a setting per role; every run records the sign-in it used; API keys remain a fallback |

## Open decisions

These choices are still open, and the first one shapes the architecture more than any other.

- [ ] **Where agents run.** This proposal assumes shared background runners for implementation, review and verification, plus a local runner on the engineer's machine. The local runner can serve every stage on the engineer's own subscription, so what is open is which stages default to hosted runners.
- [ ] **Git host.** This proposal assumes GitHub.
- [ ] **Agent and model for each role.** Which CLI and model fills each of planner, plan reviewer, implementer and implementation reviewer, Claude Code is supported first and Codex second.
- [ ] **Verification environment.** Recommended: a preview environment before merge where one exists, otherwise staging after merge.
- [ ] **What counts as trivial.** Recommended: the author proposes it, and named paths such as migrations always need peer approval.
- [ ] **Runner base.** Recommended: CI runners first. The alternative is an open-source background agent framework such as [Open-Inspect](https://github.com/ColeMurray/background-agents/wiki) or [Open SWE](https://github.com/langchain-ai/open-swe).
- [x] **Review round limit.** Decided: the `adaptive` rounds setting stops at a maximum the engineer sets from 1 to 5. At the default `ask` setting the engineer decides each time.
- [x] **Internal tool or product.** Decided: an open-source project that each team self-hosts, one deployment per team. There is no tenancy, the runner ships through npm, and the app never holds a vendor login.
- [ ] **Licence.** Recommended: Apache-2.0, which adds an explicit patent grant over MIT.
- [ ] **Plan review pipeline.** This proposal assumes plan review uses the same confirm step and triage rules as implementation review.
- [ ] **Verification orchestrator.** Recommended: add a fifth orchestrator for verification, so testing conventions live in the repo too.
- [x] **Canonical skills folder.** Decided: `.agents/skills/`, mirrored one way to `.claude/skills/` by the runner's `skills sync`, with `skills check` in each repository's CI.
- [x] **Baseline catalog.** Decided: the 21 skills in the [baseline catalog](baseline-catalog.md), 10 of them required whenever an orchestrator is chosen, each recommended by its signal in the repository.
- [ ] **Mobile app approach.** Recommended: responsive web first, then choose between a native and a cross-platform app once usage shows which screens matter on a phone.
- [ ] **One plan per feature tab.** This proposal assumes a tab yields one plan, and one pull request per repository involved. Epics that group several features come later.
- [ ] **Cross-repository orchestrators' home.** Proposed: the app keeps them, since they belong to no single repository. The alternative is a dedicated workspace repository.
- [ ] **Roles for multi-repository work.** Proposed: the cross-repository orchestrators use roles set once for them, and each repository's own orchestrator runs with that repository's settings.
- [ ] **Merge and deploy order across repositories.** Proposed: the plan's phases set the order, and the app shows it. Whether the app should enforce it is open.
- [ ] **Ticket tracker integration.** Jira through its MCP server comes first. Which trackers follow is open, as is support for self-hosted Jira. Pasting the ticket text remains the fallback.
- [x] **Deviation handling.** Decided: every deviation and extra needs an engineer's decision unless the engineer sets implementation review's `findings` to `fix_all`. The authoring agent then applies the recommended Accept or Revert to each one. Triage rules never accept or skip them.
- [ ] **Amendment levels.** Proposed: three levels set by which sections changed. Whether a decision-only amendment should need an approver is open.
- [ ] **Hosted runs on a subscription.** Each vendor allows this on different terms. Hosted Claude Code under an engineer's own plan needs confirming with Anthropic, and the fallback is a team API key for hosted roles.

## Sources

- [Cross-agent skills: Cursor, Codex, Claude Code and others, MCP Directory](https://mcp.directory/blog/cross-agent-skills-cursor-codex-cline-antigravity-gemini-mastra-portability)
- [Support for AGENTS.md and .agents/skills/, Claude Code issue 31005](https://github.com/anthropics/claude-code/issues/31005)
- [Agent skills, Codex docs](https://learn.chatgpt.com/docs/build-skills)
- [Skills sync with a drift check, OAC pull request 237](https://github.com/RossGraeber/OAC/pull/237)
- [Top CLI tools for AI agents, DEV Community](https://dev.to/hassann/top-cli-tools-for-ai-agents-2j4c)
- [Playwright CLI vs. Playwright MCP, Bug0](https://bug0.com/blog/playwright-cli-vs-playwright-mcp-ai-browser-testing-2026)
- [Playwright vs. Chrome DevTools MCP, Steve Kinney](https://stevekinney.com/writing/driving-vs-debugging-the-browser)
- [Why spec-driven development isn't enough, Brief](https://briefhq.ai/blog/why-spec-driven-development-isnt-enough/)
- [Why Ramp built Inspect, The Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect)
- [Headless Claude automation template](https://github.com/cmAIdx/headless-claude-automation-template)
- [Evolution from RPI to CRISPY, ZenML LLMOps Database](https://www.zenml.io/llmops-database/evolution-from-rpi-to-crispy-multi-stage-workflow-for-production-coding-agents)
- [Open-Inspect background agents](https://github.com/ColeMurray/background-agents/wiki)
- [Open SWE](https://github.com/langchain-ai/open-swe)
- [Use the Claude Agent SDK with your Claude plan, Claude Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude Code legal and compliance, Anthropic](https://code.claude.com/docs/en/legal-and-compliance)
- [Codex authentication, OpenAI](https://learn.chatgpt.com/docs/auth)
- [Maintain Codex account auth in CI/CD, OpenAI](https://learn.chatgpt.com/docs/auth/ci-cd-auth)
- [ChatGPT plan usage with Sign in with ChatGPT, OpenAI](https://developers.openai.com/siwc/token-sharing-open-source)

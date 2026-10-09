# Plangineer

Electron desktop app that takes a feature from a reviewed plan to verified code. Engineers write and review plans; agents implement, review and test against the plan and the repo's skills. The app runs the API, the React UI, Postgres and the runner on the engineer's own computer, where the agent CLIs are installed.

The decided stack, package layout, commands and conventions are in `docs/engineering/stack-decisions.md`. Follow it.

## Engineering standards

- Best practices, always.
- Clean code: small, well-named, single-purpose units. No dead code, commented-out code or unused exports.
- Clean architecture: clear layers and boundaries, dependencies point inward, no cross-layer shortcuts.
- Consistent style: match surrounding code and existing patterns before introducing new ones.
- Senior-developer quality on every change. Fix root causes, not symptoms.
- Cross-platform: everything must work on Windows, macOS and Linux. The dev machine is Windows; never assume its paths, shell, line endings or tools.

## Prototype stage

We are building a prototype as fast as possible. Optimize for one clean way of doing things.

- Breaking changes are safe. Change or delete freely; never preserve old behavior.
- No versioning, deprecation paths, migrations of old shapes, feature flags or experimental options.
- No fallbacks, defaults-on-failure or compatibility shims unless a recognized design best practice explicitly calls for one. Fail loudly instead.
- No speculative abstraction or features beyond the task. Build what is asked, nothing more.

## Skills

Four orchestrator skills run the plan-driven workflow. Use the one that matches the request.

- `plan-orchestrator`: plan a feature or change.
- `plan-review-orchestrator`: review a plan in `docs/plans/`, then fix the findings you pick.
- `implementation-orchestrator`: write or change code, tests, config, scripts or skills, fix bugs, and finish a branch.
- `implementation-review-orchestrator`: review a diff, branch, commit or pull request, then fix the findings you pick.

`auto-orchestrator` runs `plan-orchestrator` and then `implementation-orchestrator` unattended, fixes every kept finding and pushes to `main`. Use it only when the engineer asks for auto mode or names it.

Answering questions, reading docs and editing docs that are not feature plans need none of them.

Every other skill is a rule skill. Orchestrators load them by path, and you load one only when the user names it.

Edit skills only under `.agents/skills/`, then run `pnpm skills:sync` and `pnpm skills:lint`, which runs the runner's skill lint and then this repository's own checks. Never edit `.claude/skills/`; it is a generated copy.

## Working rules

- Work in a Git worktree, created with `pnpm worktree:new <type>/<slug>`, on its own branch. Never run `git switch` or `git checkout` in the main checkout. `.agents/skills/orchestrator-references/git-workflow.md` has the details.
- Add tests for new behavior.
- Ask only when blocked on a decision the code and spec can't answer; otherwise choose the best-practice option and note it.
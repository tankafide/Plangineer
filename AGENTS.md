# Plangineer

Web app that takes a feature from a reviewed plan to verified code. Engineers write and review plans; agents implement, review and test against the plan and the repo's skills.

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

## Working rules

- Add tests for new behavior.
- Ask only when blocked on a decision the code and spec can't answer; otherwise choose the best-practice option and note it.
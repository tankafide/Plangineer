# Execution

The detail behind the delegation rule in each orchestrator. The rule itself is stated in full in the orchestrator, so read this only when you are about to delegate.

## Reading skills

- Rule skills are read by path with the file-read tool, never through a skill tool. Hiding them from implicit invocation also blocks that route.
- Naming a skill is not applying it. Read its `SKILL.md`, then follow it.
- Load a skill only when the task reaches its area, and reuse what is already in context. A skill may be read more than once, such as `testing` once per phase or `security` once per affected area.
- Resolve links relative to the file that holds them.

## What a handoff holds

A subagent inherits nothing. Every handoff states:

- The objective, in one or two sentences.
- The exact skill paths to read, and the mode each applies in (for example `data-model-design` in review mode).
- The decisions and contracts already settled, quoted or linked, not summarized.
- The input files, the plan path and the base commit where they exist.
- Whether it may edit, and if so exactly which files it owns.
- The checks that show it is done.
- The result to return.

## Parallel writers

- Code changes stay single-threaded by default.
- Use parallel writers only after shared contracts are settled, and give each a disjoint set of files. The orchestrator owns shared files: `packages/contracts`, the lockfile, generated files and `package.json` edits.
- Serialize edits to any file two writers might touch. Never revert work you did not do.

## What a subagent returns

- Decisions made or changes made, with the files affected.
- Evidence: the checks it ran and their results, or the findings in the [finding format](finding-format.md).
- Blockers and open questions.

A subagent's success report is not integration evidence. The orchestrator reads the result, resolves conflicting advice and checks behavior across the boundaries between the pieces.

## Reporting

- List the rule skills that were applied, by the orchestrator or a subagent, and the mode each ran in. A skill that was routed but not read is not listed.

## Limits

- If the CLI cannot delegate, apply the guidance inline.

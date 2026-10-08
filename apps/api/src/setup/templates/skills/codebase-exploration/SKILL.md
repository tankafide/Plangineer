---
name: codebase-exploration
description: Propose which repositories a feature involves (triage mode), map the code a feature touches as context for a plan (explore mode), or check a plan against the code at its base commit and return mismatches and missed areas as findings (verify mode). Stands alone and needs no other skill.
disable-model-invocation: true
---

# Codebase exploration

Needs no other skill. Pick the mode closest to the request and say which one you ran.

| Mode | Use when | Inputs |
| --- | --- | --- |
| Triage | Which repositories does a feature involve? | Feature brief, every candidate repository with its description |
| Explore | Map the code a feature touches | Feature brief, one repository. Optional: a base branch or commit, an overlap list of files for a replan |
| Verify | Check a plan against the code | A plan in `docs/plans/`, one repository. Optional: the context files it was built from |

## Rules

- Read only. Never edit, run or test the code.
- **Base commit.** Verify uses the plan's. Explore uses the caller's base if given. Otherwise use the default branch tip (`git rev-parse {{defaultBranch}}`). Never default to `HEAD`.
- When `HEAD` differs from the base, read with `git show <sha>:<path>` and `git grep <pattern> <sha>`. Mention uncommitted changes that differ.
- Every claim names a path, plus a function or line range where it can. Never infer behavior from names.
- Write "not found" rather than guess. Write "unknown from code" for any number the code or git does not show, such as row counts, traffic or latency.
- Paths use forward slashes, relative to the repository root.
- Run independent searches and reads in parallel.

## How to search

1. Read in full any file, symbol or ticket the brief names.
2. Except in triage, read the repository's `AGENTS.md`, `CLAUDE.md`, `README.md` and the docs they point to for layout and conventions.
3. Search wide, then narrow: names, imports, routes, tables, interface text. Before writing "not found", try synonyms, other casings and the repository's naming conventions.
4. Open a file only once search shows it matters.

## Triage mode

Search each repository's default branch tip for the brief's nouns and verbs. Open a file only when a hit is ambiguous. Do not trace. Return one row per repository, in the reply unless the caller names a file:

| Repository | Proposal | Evidence |
| --- | --- | --- |
| `<name>` | involved, not involved or unsure | Matching paths, or the description line that decided it |

Mark "unsure" rather than guess. The engineer decides.

## Explore mode

Describe what exists, how it works and what is risky. Never propose a design or fix: the planner decides.

1. **Terms.** List the brief's nouns and verbs: entities, screens, procedures, tables, events.
2. **Search** for each.
3. **Trace** each entry point (route, handler, screen, command, job, event consumer) through every layer to storage and back.
4. **Neighbours.** For each traced file, follow imports one level each way and find its tests.
5. **Patterns.** Find the one or two closest existing features and the files that show how they are built.
6. **Reusable code.** Find the existing functions, types, schemas, components and modules the change could use or extend, with their paths.
7. **History.** `git log --oneline -n 10 <sha> -- <path>` on key files, for recent refactors and churn.
8. **Stop** when every term maps to a file or "not found" and every entry point is traced.

With an overlap list, explore only those files and what directly touches them, and skip steps 5 and 6.

Return the context in the reply. Write a context file only when the caller asks for one, as a pre-planning task does: at the path it names, or else `docs/plans/context/YYYY-MM-DD-<slug>.md` (kebab-case slug, plus `-<repo>` for multi-repository features). Either way, use the template below, under 1,500 words and 25 table rows. If it does not fit, keep the most important rows and say so under open questions. Keep every heading, writing "None found" when empty.

````markdown
# Context: <feature name>

Base commit: <full sha> on <branch>
Repository: <name>
Explored: <YYYY-MM-DD>

## Start here

- 3 to 7 paths to read first, one line each on why.

## Files and functions

| Path | Symbol | Role in this feature |
| --- | --- | --- |

## How it works today

Short prose from entry point to storage and back, naming each step's file.

## Patterns to follow

- Closest existing features, with the files that show how they are built.
- Repository conventions that apply.

## Reusable code

| Path | Symbol | What it does |
| --- | --- | --- |

## Open questions

- What the code could not settle, and what the answer changes.

## Risk flags

- Scale: hot paths, large tables, unbounded lists, new queries, with the code that shows it.
- Recent churn.
- Shared code with many callers, missing tests, cross-platform traps.

## Tests today

- What covers the area and what is left uncovered.
````

## Verify mode

1. **Base.** Use the commit the plan or its context files name, or the default branch tip and say so. If main has moved, list the commits since that touch files the plan names.
2. **Claims.** Confirm every file, function, table, contract, route and statement about current behavior. Paths the plan edits must exist. Paths it creates must not exist yet, but their folders must.
3. **Outward.** For each existing file the plan edits, find callers, importers, tests, contracts and tables the change affects that the plan does not mention. Skip this when the plan edits no existing code.
4. **Context files.** Confirm their claims still hold at the base.

| Case | Severity |
| --- | --- |
| The plan contradicts the code, or names a missing file or symbol | `blocker` if a step depends on it, else `should fix` |
| An affected caller, importer, test, contract or table is missing from the plan | `should fix`, or `blocker` if the change breaks it |
| A context file claim is stale | `should fix` |
| A misnamed item whose target is unambiguous | `nit` |

Raise defects only. Confirm each against the code, drop what you cannot support, merge duplicates and mark unverified concerns as such. Order by severity, `blocker` first. Write to the file the caller names, otherwise reply. With no findings, say so without implying the check was exhaustive.

```markdown
### <short title>

- Location: <line range in the plan>
- Claim: <what is wrong, with the code file and lines that show it>
- Kind: defect
- Severity: blocker | should fix | nit
- Suggested change: <what the plan should say instead>
- Source skill: codebase-exploration
```

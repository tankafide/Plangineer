# Skill specification

Oct 8, 2026

A setup skill is a skill that repository setup writes into a target repository. This spec states what each setup skill holds, how its parts are filled, and how the setup agent writes and reviews it. The file rules come from the skill file table in [agent-instructions](../../.agents/skills/agent-instructions/SKILL.md), and the section layout comes from Plangineer's own rule skills. The [baseline catalog](baseline-catalog.md) lists the skills setup offers.

## Parts

| Part | Rule |
| --- | --- |
| Location | `.agents/skills/<name>/SKILL.md`, mirrored to `.claude/skills/` by `plangineer-runner skills sync` |
| Frontmatter | `name` equal to the folder name, `description`, and `disable-model-invocation: true` for rule skills only. No other field |
| `agents/openai.yaml` | Rule skills only, holding `policy.allow_implicit_invocation: false` |
| Rule skill body | A title, one paragraph of scope, then `## Rules`, `## Plan mode`, `## Implement mode`, `## Plan review mode` and `## Implementation review mode`. Each review mode holds a table of checks with severities `blocker`, `should fix` and `nit` |
| Orchestrator body | Rendered from Plangineer's templates. Holds the workflow steps and a routing table of rule skill paths with when each applies |
| Project facts | Every skill links to `project-stack` for the repository's stack, layout, commands and conventions, and never restates them |
| Limits | `SKILL.md` under 500 lines, `description` at most 1,024 characters, `name` at most 64 characters of lowercase letters, digits and hyphens, never containing `claude` or `anthropic` |

## Kinds

Each catalog skill has one of three kinds. The kind sets where the skill's text comes from.

| Kind | Source | What the agent does |
| --- | --- | --- |
| `fixed` | A Plangineer template that matches Plangineer's own skill of the same name, with repository values such as the default branch filled in | Nothing |
| `template` | A Plangineer template: Plangineer's own skill with its stack-specific parts replaced by slots | Replaces each slot line with content drawn from the repository |
| `generated` | No template | Writes the whole skill from the repository's code, to the rule skill body above |

## Slots

A slot is one line in a template skill:

```text
<!-- slot: <kind> <slot-name>: <what to write> -->
```

`<slot-name>` is lowercase letters, digits and hyphens. The agent replaces the whole line and changes nothing else in the file. A slot has one of two kinds:

| Kind | Holds | Drawn from |
| --- | --- | --- |
| `fact` | What the repository is: its stack, layout, commands and tools | The repository only. A fact it lacks is written as "Not found in this repository:" and what is missing |
| `rule` | How work should be done in this stack | Research, the model's own knowledge and the repository's conventions, merged as below |

## Research

A `rule` slot and a generated skill start from research. A `fact` slot never does, because research cannot know a repository's commands or layout.

1. Search the web for widely used agent skills and rule files on the same topic and stack, such as public `SKILL.md`, `AGENTS.md` and Cursor rules files, and the libraries' own docs. Read up to 5 sources per skill.
2. Keep a rule only when it applies to the versions the repository uses, can be checked on a diff, and is something a capable model would not do unprompted.
3. Merge the kept rules with the model's own knowledge and the repository's conventions. The repository wins a conflict.
4. Write each rule in its own words, never copying a source's text.
5. List the URLs used per skill in the run's final message, never in the skill.

## Token efficiency

A skill says what the agent needs in as few words as possible: one line per rule, tables for anything compared, and no long paragraphs, background or examples that teach nothing new. The reviewer subagent checks this rule on every skill. The lint enforces only the 500-line limit.

## Authoring workflow

Every template skill and generated skill goes through two subagents, and is ready once the second returns:

| Order | Subagent | Does |
| --- | --- | --- |
| 1 | Writer | Owns one skill folder. Researches the skill's `rule` parts, reads the repository for its `fact` parts, and fills the slots or writes the skill |
| 2 | Reviewer | Starts fresh with the skill's path, its catalog purpose and the checklist below. Raises findings, applies every one, and returns the findings and what it changed |

The reviewer's checklist:

| Check | Passes when |
| --- | --- |
| On target | The skill does its catalog purpose, each slot answers its instruction, and the text names the repository's real paths, commands and libraries |
| Token efficient | Each rule is one succinct line, comparisons are tables, no paragraph could be shorter without losing a fact, and the skill holds no advice a capable model follows unprompted and no rule repeated from `project-stack` or another skill |
| Best practice | Each rule fits the library versions the repository uses, can be checked on a diff, and agrees with the research sources |
| Specification | The file rules hold, the fixed text of a template skill is unchanged, and no slot line is left |

`project-stack` goes through both subagents first, because every other skill links to it. The rest then run in parallel, one writer per skill folder.

## `project-stack`

`project-stack` is a template skill with the fixed headings `## Context`, `## Stack`, `## Layout`, `## Commands` and `## Conventions`, each holding one slot. Its Commands table has a row named `check`, the one command that must pass before work is done. In a target repository, `project-stack` stands in for Plangineer's [stack decisions](../engineering/stack-decisions.md): the one place that holds the stack, layout, commands and conventions.

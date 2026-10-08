---
name: writing-style
description: How plans, pull request descriptions and docs read in this repository. Use when drafting or revising a plan, a pull request description or a doc, and when checking a plan's prose.
disable-model-invocation: true
---

# Writing style

How text in `docs/` and pull request descriptions reads. `plan-format` fixes a plan's structure. This fixes its prose.

## Rules

- **Lead with the point.** The first sentence of a section or paragraph states the conclusion. Reasons follow.
- **One idea per sentence.** Keep most under 25 words. Put a condition before its instruction: "To retry a run, call `retryRun`."
- **One term per concept.** Pick a name and use it everywhere. Do not alternate "runner", "agent host" and "worker" for one thing. Define a term where it first appears, or link to its definition.
- **Name the noun.** Never start a sentence with a bare "this" or "it" that could point at two things. Write "This lease", not "This".
- **Specifics, not adjectives.** Give the number, the name, the path and the command. "Under 72 characters" beats "short".
- **Plain words.** "Use", not "utilize" or "leverage". Cut words that sound thorough and carry nothing: "robust", "seamless", "comprehensive", "powerful", "simply", "just", "easy".
- **No filler or hedging.** Cut "it should be noted", "basically", "in order to", "might", "perhaps" and "we could consider". If something is undecided, say so and name who decides.
- **Active voice, present tense.** "The runner stops the process", not "The process will be stopped".
- **Absolute dates.** "Oct 7, 2026", never "today", "last week" or "recently".
- **Tables for comparisons.** Items compared on the same attributes go in a table. Numbered lists for steps in order, bullets for short parallel items. List items share one grammatical form.
- **Links.** Put the link where the claim is, with text that names the target: `[the Anthropic post](url)`, never "here" or a bare URL. No link list at the end.
- **Formatting.** Code format for paths, commands, identifiers and values. Bold only the term a bullet defines, followed by a full stop. Headings are short nouns in sentence case, numbered only for plan steps.
- **Punctuation.** American spelling. No em dashes or exclamation marks. Use a full stop or a colon.
- **No emojis.** The only symbols are the ticks in the test plan grid.
- **No generated-text tics.** No "not X, but Y" contrasts, reflexive groups of three, rhetorical questions or closing summaries that restate the section.

## Plan mode

Write each section to these rules as you draft it. Before finishing, read the plan once for sentences that open with a reason, hedges, relative dates, terms that drift and prose that should be a table.

## Implement mode

Applies to pull request descriptions. Open with what the change does and why, in two sentences at most. Then the sections [git workflow](../orchestrator-references/git-workflow.md#pull-request-description) lists: the plan summary with a link, the findings history, each departure from the plan with its decision, and which checks ran and which did not. Findings and checks go in tables. Never claim a check passed that did not run.

## Plan review mode

Check the plan's prose against the rules. Raise each break as a `nit` in the [finding format](../orchestrator-references/finding-format.md), with `writing-style` as the source skill. Group repeated breaks of one rule into one finding that lists the locations. Wording that leaves a step open to two readings is not a style nit. Raise it as a `should fix` defect with `plan-format` as the source skill.

## Examples

| Instead of | Write |
| --- | --- |
| Basically, we might want to leverage a robust queue | Dispatch uses the `runs` table. No queue library |
| This will be done soon | Done by Oct 14, 2026 |
| The performance should be good | A list of 500 plans loads in under 300 ms on the seeded database |

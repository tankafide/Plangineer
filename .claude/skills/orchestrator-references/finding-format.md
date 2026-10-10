# Finding format

Every finding in a review, of a plan or of a diff, has these fields. The reviewer fills them, and the author judges them with `finding-verification` before fixing any.

| Field | Contents |
| --- | --- |
| Location | A line range in the plan, or a file and lines in the diff |
| Claim | What is wrong, in one or two sentences |
| Kind | `defect`, `deviation` or `extra` |
| Severity | `blocker`, `should fix` or `nit` |
| Suggested change | What the reviewer would do instead |
| Source skill | The rule skill the reviewer applied, or `none` |

## Values

- **Kind.** A defect is anything wrong in the plan or the code. A deviation is a plan step or decision the code does not follow, or a step not built. An extra is a change in the diff that no step asked for. Departures are expected, so a deviation or an extra is raised only when it is not sound, as [plan-conformance](../plan-conformance/SKILL.md) judges. It names the plan step it relates to. Plan reviews raise defects only.
- **Severity.** `blocker` stops the work from being correct or safe. `should fix` is a real problem that does not block. `nit` is a style or preference point.

## Reviewer rules

- Validate every finding against the code or the plan before writing it. Drop what you cannot support, and merge duplicates.
- Raise a finding only with a concrete location, a claim and a suggested change.
- Say when a concern is unverified rather than presenting it as a defect.
- Order findings by severity, `blocker` first.

## Findings file

How a review round's findings reach the author. A JSON object:

| Field | Contents |
| --- | --- |
| `review` | `plan` or `implementation` |
| `planPath` | The plan reviewed or built against, or null for an implementation review with no plan |
| `baseCommit` | The diff's base commit, or null for a plan review |
| `headCommit` | The commit the review ran against |
| `planAudit` | The plan audit from `plan-conformance` as Markdown, or null when the review had none |
| `findings` | An array of findings, each with `location`, `claim`, `kind`, `severity`, `suggestedChange` and `sourceSkill` |

By hand, the review orchestrator writes it to the operating system's temporary folder as `plangineer-<slug>-<plan|implementation>-review-<UTC timestamp>.findings.json`. `<slug>` is the plan's slug, or the branch's slug when the review has no plan. A review with no findings writes no file and tells the engineer the round found nothing.

## Author's fields

The author adds these to each finding when it judges it:

| Field | Contents |
| --- | --- |
| Verdict | `valid` or `invalid` |
| Reason | One line: why it is valid or invalid |
| Done | `fixed` or `reverted`, `skipped` by the engineer, or `none` for an invalid finding |

## Presenting findings

Under `findings: ask`, the author shows the engineer the valid findings this way, so each carries enough context to judge it without opening the plan or the code.

1. **Summary.** Open with two sentences: how many findings were valid and invalid, by severity, and whether the plan or change is safe to build or merge as it stands.
2. **Groups.** Group the valid findings by what they share, such as "breaks the build", "breaks a rule skill" or "missing from the spec", most severe group first. Give each group a one-line heading that says what its findings have in common.
3. **Each finding.** A heading with the number, a plain-words title and the severity. Then five lines:

   | Line | Contents |
   | --- | --- |
   | What it says now | What the plan or code does at the location, in plain words |
   | What's wrong | The claim, with any tool or rule named and explained the first time it appears |
   | If not fixed | The concrete consequence: what fails, when, and who notices |
   | Evidence | What the author checked or ran to confirm it |
   | Fix and cost | The suggested change and how big it is |

4. **Invalid.** List the invalid findings one line each, with the reason, so the engineer can pull one back.
5. **Choice.** Ask after the findings, as a multi-select question when the CLI has one. Offer the groups as choices, and let the engineer name single findings by number instead.

## Outcomes

The round's fix commit lists every finding with its verdict, its reason and what was done. See [git workflow](git-workflow.md#commits).

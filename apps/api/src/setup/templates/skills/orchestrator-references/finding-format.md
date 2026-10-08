# Finding format

Every finding in a review, of a plan or of a diff, has these fields. The reviewer fills them, and `finding-verification` checks them before the engineer sees any.

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

## Presenting findings

The engineer decides from what the review shows, so each kept finding carries enough context to judge it without opening the plan or the code. Both review orchestrators present findings this way.

1. **Summary.** Open with two sentences: how many findings were kept and dropped, by severity, and whether the plan or change is safe to build or merge as it stands.
2. **Groups.** Group the kept findings by what they share, such as "breaks the build", "breaks a rule skill" or "missing from the spec", most severe group first. Give each group a one-line heading that says what its findings have in common.
3. **Each finding.** A heading with the number, a plain-words title, the severity and the recommendation. Then five lines:

   | Line | Contents |
   | --- | --- |
   | What it says now | What the plan or code does at the location, in plain words |
   | What's wrong | The claim, with any tool or rule named and explained the first time it appears |
   | If not fixed | The concrete consequence: what fails, when, and who notices |
   | Evidence | What verification checked or ran to confirm it |
   | Fix and cost | The suggested change and how big it is |

4. **Skipped and dropped.** List kept findings recommended to skip one line each, with the reason. Then list the dropped findings one line each, with the reason, so the engineer can pull one back.
5. **Choice.** Ask after the findings, as a multi-select question when the CLI has one. Offer the groups as choices, with the recommended ones marked `(Recommended)`, and let the engineer name single findings by number instead. A deviation or extra is its own choice between keeping it and reverting it.

## Outcomes

Findings stay in the conversation, and no file is written. The fix commit records each one's outcome: a defect is `fixed`, `skipped` or `dropped` by verification, and a deviation or extra is `kept` or `reverted`. See [review loop](review-loop.md).

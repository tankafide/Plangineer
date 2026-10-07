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

## Outcomes

Findings stay in the conversation, and no file is written. The fix commit records each one's outcome: a defect is `fixed`, `skipped` or `dropped` by verification, and a deviation or extra is `kept` or `reverted`. See [review loop](review-loop.md).

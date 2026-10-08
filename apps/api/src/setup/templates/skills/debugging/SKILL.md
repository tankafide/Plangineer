---
name: debugging
description: Fixes a bug at its root cause by reproducing it with a failing test at the lowest layer, fixing it, keeping the test, and never fixing a symptom. Implement mode only.
disable-model-invocation: true
---

# Debugging

Fix the cause, not the symptom. For the stack, see [project-stack](../project-stack/SKILL.md), and for test rules, [testing](../testing/SKILL.md).

## Lowest layer by symptom

<!-- slot: fact reproduce-by-layer: a table of where a bug shows in this repository and the lowest test layer and tool to reproduce it with first -->

## Implement mode

1. **Reproduce with a failing test.** Write the test first, at the lowest layer that shows the bug, from the table above, and watch it fail for the reason the bug report gives. A test that fails for another reason, such as a typo or a missing fixture, does not count.
2. **Find the root cause.**
   - Read the whole error and stack trace before forming a theory.
   - For a regression, read `git log` and the diff since it last worked. Use `git bisect run` with the failing test when the range is wide.
   - Trace the bad value backward through its callers to where it is first wrong. A fix where it surfaces is a symptom fix.
   - Compare with similar code that works and list every difference.
   - Test one hypothesis at a time with one change. Revert a change that disproves it before trying the next.
   - State in one sentence why the code produces the wrong result.
3. **Fix the cause.** Make the smallest change that removes it, in the layer that owns the behavior. Do not add a second path beside the broken one.
4. **Keep the test.** It stays as a regression test, named for the behavior it protects. See it pass, then run the layers above it.
5. **Clean up.** Remove every diagnostic log, breakpoint and reverted experiment.
6. **Check for the same cause elsewhere.** Search for the same pattern: the same function misused, the same unchecked assumption, a copy of the faulty code. Fix each hit. If a fix is large enough to need its own plan, list it in the report.

## Never

- Wrap the failing call in a `try`/`catch` that swallows or logs the error.
- Special-case the input that triggered the bug, such as an `if` for one id, one string or one platform.
- Loosen a type, an assertion or a lint rule so the failure goes away.
- Add a sleep, a longer timeout or a retry for a timing bug. Wait on the condition or fix the race.
- Delete or skip the test that caught the bug.
- Try a fourth fix after three have failed. Stop and report the attempts to the engineer: the design is likely wrong.

A bug is fixed when the correct path works, not when the error stops appearing.

## When no test can reproduce it

For a bug seen only on one platform, with real timing or against a real external tool or service:

- Fix the cause as above.
- Write the manual steps that reproduce the bug: the system, the exact commands, and the expected and actual result.
- State in one sentence why no test can show it.
- Put the steps and the reason in the final report and the pull request description, so a reviewer can run them.

Never call a bug fixed because it could not be reproduced. If it cannot be reproduced even by hand, say so and stop.

import { describe, expect, it } from 'vitest';
import { acceptanceCriteria, planMarkdown } from './plan-markdown.ts';
import { planBodyFixture, stepFixture, uuid } from './test-fixtures.ts';

describe('acceptanceCriteria', () => {
  it('labels each done-when line with its step number and a letter, in plan order', () => {
    expect(acceptanceCriteria(planBodyFixture())).toEqual([
      { lineId: uuid(21), label: '1a', text: 'A plan renders as a PDF.' },
      { lineId: uuid(22), label: '1b', text: 'An empty plan is refused.' },
      { lineId: uuid(31), label: '2a', text: 'The button downloads the PDF.' },
    ]);
  });

  it('labels twelve lines a to l', () => {
    const doneWhen = Array.from({ length: 12 }, (_, index) => ({
      id: uuid(100 + index),
      text: 'X.',
    }));
    const labels = acceptanceCriteria(planBodyFixture({ steps: [stepFixture({ doneWhen })] }));
    expect(labels.at(-1)?.label).toBe('1l');
  });
});

describe('planMarkdown', () => {
  it('writes every section in plan-format order, marking a stale row', () => {
    const body = planBodyFixture({
      prerequisites: [{ id: uuid(10), item: 'A font | licence', who: 'Ada', status: 'open' }],
      steps: [
        stepFixture(),
        stepFixture({ id: uuid(30), title: 'Ship it', files: [], body: '', doneWhen: [] }),
      ],
      constraints: [{ id: uuid(50), title: 'Size', target: 'Under 5 MB.', check: 'A test.' }],
      coverage: [
        { lineId: uuid(21), ticks: ['unit', 'end_to_end'], stale: false },
        { lineId: uuid(22), ticks: [], stale: true },
        { lineId: uuid(50), ticks: ['human_check'], stale: false },
      ],
      blockers: [{ id: uuid(60), section: 'goal', stepId: null, text: 'A hidden blocker.' }],
      verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: ['Open the PDF'] },
    });
    expect(planMarkdown(body)).toBe(`## Goal

Let engineers export a plan as PDF.

## Prerequisites

| Item | Who | Status |
| --- | --- | --- |
| A font \\| licence | Ada | open |

## Steps

### 1. Render the PDF

**Files:** \`apps/api/src/pdf.ts\`

Render the plan with the PDF library.

**Done when:**

- 1a. A plan renders as a PDF.
- 1b. An empty plan is refused.

### 2. Ship it

## Decisions

- **Server rendering.** Fonts match.

## Constraints

- **Size.** Target: Under 5 MB. Check: A test.

## Test plan

| Line | Unit | Integration | Component | End to end | Agent check | Human check |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1a. A plan renders as a PDF. | ✓ |  |  | ✓ |  |  |
| 1b. An empty plan is refused. (stale) |  |  |  |  |  |  |
| Size |  |  |  |  |  | ✓ |

## Verification

**Automated**

- pnpm verify

**Human checks**

- Open the PDF
`);
  });

  it('leaves out prerequisites and constraints when there are none', () => {
    const markdown = planMarkdown(planBodyFixture());
    expect(markdown).not.toContain('## Prerequisites');
    expect(markdown).not.toContain('## Constraints');
  });

  it('keeps a table row on one line', () => {
    const body = planBodyFixture({
      steps: [stepFixture({ doneWhen: [{ id: uuid(21), text: 'Line one\nline two' }] })],
      coverage: [{ lineId: uuid(21), ticks: [], stale: false }],
    });
    expect(planMarkdown(body)).toContain('| 1a. Line one line two |');
  });
});

import type { PlanBody, PlanStep } from '@plangineer/contracts';

const REPOSITORY_ID = '0199c1a2-7b3c-7d4e-8f90-000000000001';

/** A uuid whose last digits are the given number, so ids read apart in a test. */
export const uuid = (n: number) => `0199c1a2-7b3c-7d4e-8f90-${String(n).padStart(12, '0')}`;

/** Fresh ids for adoption, `uuid(901)` onwards, so a test sees which ids were made. */
export function idSource() {
  let next = 0;
  return () => {
    next += 1;
    return uuid(900 + next);
  };
}

export function stepFixture(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: uuid(20),
    repositoryId: REPOSITORY_ID,
    title: 'Render the PDF',
    files: ['apps/api/src/pdf.ts'],
    body: 'Render the plan with the PDF library.',
    doneWhen: [
      { id: uuid(21), text: 'A plan renders as a PDF.' },
      { id: uuid(22), text: 'An empty plan is refused.' },
    ],
    ...overrides,
  };
}

/** A ready body: two steps with files and lines, every line ticked, no stale row, no blocker. */
export function planBodyFixture(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    goal: 'Let engineers export a plan as PDF.',
    prerequisites: [],
    steps: [
      stepFixture(),
      stepFixture({
        id: uuid(30),
        title: 'Add the export button',
        files: ['apps/web/src/export.tsx'],
        body: 'A button on the plan screen.',
        doneWhen: [{ id: uuid(31), text: 'The button downloads the PDF.' }],
      }),
    ],
    decisions: [{ id: uuid(40), title: 'Server rendering', reason: 'Fonts match.', by: 'agent' }],
    constraints: [],
    coverage: [
      { lineId: uuid(21), ticks: ['unit'], stale: false },
      { lineId: uuid(22), ticks: ['unit', 'integration'], stale: false },
      { lineId: uuid(31), ticks: ['component'], stale: false },
    ],
    blockers: [],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

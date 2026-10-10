import type { PlanBody, PlanDraft } from './plan-body.ts';

export const REPOSITORY_ID = '0199c1a2-7b3c-7d4e-8f90-000000000001';

/** A uuid whose last digits are the given number, so ids read apart in a test. */
export const uuid = (n: number) => `0199c1a2-7b3c-7d4e-8f90-${String(n).padStart(12, '0')}`;

/** A full body: every section filled, every line covered, one blocker on step 1. */
export function planBodyFixture(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    goal: 'Let engineers export a plan as PDF.',
    prerequisites: [{ id: uuid(10), item: 'A PDF font licence', who: 'Engineer', status: 'open' }],
    steps: [
      {
        id: uuid(20),
        repositoryId: REPOSITORY_ID,
        title: 'Render the PDF',
        files: ['apps/api/src/pdf.ts'],
        body: 'Render the plan with the PDF library.',
        doneWhen: [
          { id: uuid(21), text: 'A plan renders as a PDF.' },
          { id: uuid(22), text: 'An empty plan is refused.' },
        ],
      },
      {
        id: uuid(30),
        repositoryId: REPOSITORY_ID,
        title: 'Add the export button',
        files: ['apps/web/src/export.tsx'],
        body: '',
        doneWhen: [{ id: uuid(31), text: 'The button downloads the PDF.' }],
      },
    ],
    decisions: [{ id: uuid(40), title: 'Server rendering', reason: 'Fonts match.', by: 'agent' }],
    constraints: [{ id: uuid(50), title: 'Size', target: 'Under 5 MB', check: 'A unit test' }],
    coverage: [
      { lineId: uuid(21), ticks: ['unit'], stale: false },
      { lineId: uuid(22), ticks: ['unit', 'integration'], stale: false },
      { lineId: uuid(31), ticks: ['component'], stale: false },
      { lineId: uuid(50), ticks: ['unit'], stale: false },
    ],
    blockers: [{ id: uuid(60), section: 'steps', stepId: uuid(20), text: 'Pick a PDF library.' }],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: ['Open the PDF'] },
    ...overrides,
  };
}

/** A whole draft with the free-text ids an agent writes. */
export function planDraftFixture(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    goal: 'Let engineers export a plan as PDF.',
    prerequisites: [],
    steps: [
      {
        id: 'new-1',
        title: 'Render the PDF',
        files: ['apps/api/src/pdf.ts'],
        body: 'Render the plan.',
        doneWhen: [{ id: 'new-2', text: 'A plan renders as a PDF.' }],
      },
    ],
    decisions: [{ id: 'new-3', title: 'Server rendering', reason: 'Fonts match.', by: 'agent' }],
    constraints: [],
    coverage: [{ lineId: 'new-2', ticks: ['unit'] }],
    blockers: [{ id: 'new-4', section: 'steps', stepId: 'new-1', text: 'Pick a PDF library.' }],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

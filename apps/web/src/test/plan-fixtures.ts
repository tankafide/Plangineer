import type {
  PlanBody,
  PlanConflictReason,
  PlanningTurn,
  PlanRevision,
  PlanWorkspace,
} from '@plangineer/contracts';
import { featureFixture, FEATURE_ID } from './feature-fixtures.ts';
import { answerJson, answerProcedure, COMMIT, REPOSITORY_ID, RUN_ID } from './fixtures.ts';

/** A uuid whose last digits are the given number, so plan item ids read apart in a test. */
const planId = (n: number) => `0199c1a9-7777-7d4e-8f90-${String(n).padStart(12, '0')}`;

/** A ready body of two steps, each with one covered done-when line. */
export function planBodyFixture(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    goal: 'Export invoices as CSV.',
    prerequisites: [],
    steps: [1, 2].map((number) => ({
      id: planId(number),
      repositoryId: REPOSITORY_ID,
      title: `Step ${number}`,
      files: [`src/step-${number}.ts`],
      body: '',
      doneWhen: [{ id: planId(10 + number), text: `Step ${number} works.` }],
    })),
    decisions: [],
    constraints: [],
    coverage: [
      { lineId: planId(11), ticks: ['unit'], stale: false },
      { lineId: planId(12), ticks: ['unit'], stale: false },
    ],
    blockers: [],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

export function planRevisionFixture(overrides: Partial<PlanRevision> = {}): PlanRevision {
  return {
    id: planId(100 + (overrides.number ?? 1)),
    number: 1,
    source: 'agent',
    createdAt: '2026-10-10T10:00:00.000Z',
    body: planBodyFixture(),
    acceptanceCriteria: [
      { lineId: planId(11), label: '1a', text: 'Step 1 works.' },
      { lineId: planId(12), label: '2a', text: 'Step 2 works.' },
    ],
    contextFiles: [],
    baseCommits: [{ repositoryId: REPOSITORY_ID, commit: COMMIT }],
    ...overrides,
  };
}

export function planningTurnFixture(overrides: Partial<PlanningTurn> = {}): PlanningTurn {
  return {
    id: planId(200),
    kind: 'guided',
    section: null,
    action: null,
    stepId: null,
    runId: RUN_ID,
    status: 'succeeded',
    createdAt: '2026-10-10T09:59:00.000Z',
    ...overrides,
  };
}

export function planWorkspaceFixture(overrides: Partial<PlanWorkspace> = {}): PlanWorkspace {
  return {
    featureId: FEATURE_ID,
    featureState: 'planning',
    runMode: 'manual',
    workflowSettings: featureFixture().workflowSettings,
    revision: planRevisionFixture(),
    turn: planningTurnFixture(),
    questions: [],
    decisions: [],
    readiness: [],
    sections: [],
    autoLoopStopped: false,
    ...overrides,
  };
}

/** A plan write refused with CONFLICT for this reason. */
export function planConflict(reason: PlanConflictReason) {
  return () =>
    Response.json(
      {
        json: {
          defined: true,
          code: 'CONFLICT',
          status: 409,
          message: 'Conflict',
          data: { reason },
        },
        meta: [],
      },
      { status: 409, headers: { Connection: 'close' } },
    );
}

/**
 * Answers the plan workspace's two reads: feature.get with the planning feature, and plan.get
 * with each response in turn. Returns plan.get's recorded inputs.
 */
export function answerPlanWorkspace(...responses: Array<() => Response | Promise<Response>>) {
  answerProcedure('feature/get', answerJson(featureFixture({ state: 'planning' })));
  return answerProcedure('plan/get', ...responses);
}

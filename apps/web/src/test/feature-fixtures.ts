import type { ContextFile, FeatureDetail, FeatureSummary } from '@plangineer/contracts';
import { REPOSITORY_ID, RUN_ID } from './fixtures.ts';

export const FEATURE_ID = '0199c1a6-4444-7d4e-8f90-a1b2c3d4e5f6';
const TASK_ID = '0199c1a7-5555-7d4e-8f90-a1b2c3d4e5f6';
export const CONTEXT_FILE_ID = '0199c1a8-6666-7d4e-8f90-a1b2c3d4e5f6';

const FEATURE_REPOSITORY = { id: REPOSITORY_ID, owner: 'acme', name: 'web-app' };

type PrePlanningTask = FeatureDetail['tasks'][number];

export function taskFixture(overrides: Partial<PrePlanningTask> = {}): PrePlanningTask {
  return {
    id: TASK_ID,
    kind: 'intake',
    repository: FEATURE_REPOSITORY,
    topic: null,
    runId: RUN_ID,
    status: 'queued',
    commit: null,
    ...overrides,
  };
}

export function featureFixture(overrides: Partial<FeatureDetail> = {}): FeatureDetail {
  return {
    id: FEATURE_ID,
    title: 'Export invoices as CSV',
    state: 'pre_planning',
    runMode: 'manual',
    createdAt: '2026-10-09T10:00:00.000Z',
    description: 'Export invoices as CSV from the billing page.',
    ticketUrl: null,
    exploreCodebase: false,
    workflowSettings: {
      decisions: 'ask',
      planCheckIn: 'pause',
      planReview: { findings: 'ask', rounds: { mode: 'ask' } },
      implementationReview: { findings: 'ask', rounds: { mode: 'ask' } },
    },
    repositories: [FEATURE_REPOSITORY],
    attachments: [],
    tasks: [taskFixture()],
    contextFiles: [],
    updatedAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

export function featureSummaryFixture(overrides: Partial<FeatureSummary> = {}): FeatureSummary {
  const { id, title, state, runMode, createdAt } = featureFixture();
  return { id, title, state, runMode, createdAt, ...overrides };
}

export function contextFileFixture(overrides: Partial<ContextFile> = {}): ContextFile {
  return {
    id: CONTEXT_FILE_ID,
    taskId: TASK_ID,
    featureId: FEATURE_ID,
    title: 'Feature brief',
    ticked: true,
    content: '# Feature brief',
    updatedAt: '2026-10-09T10:05:00.000Z',
    ...overrides,
  };
}

/** A context file as the feature lists it, without its feature id and content. */
export function contextFileSummaryFixture(
  overrides: Partial<ContextFile> = {},
): FeatureDetail['contextFiles'][number] {
  const { id, taskId, title, ticked, updatedAt } = contextFileFixture(overrides);
  return { id, taskId, title, ticked, updatedAt };
}

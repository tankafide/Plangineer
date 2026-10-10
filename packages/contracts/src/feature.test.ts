import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_BYTES_MAX,
  FeatureCreateInput,
  FeatureDetail,
  FEATURE_DESCRIPTION_MAX,
} from './feature.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const OTHER_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f7';
const AT = '2026-10-09T12:00:00.000Z';

const file = (size: number, name = 'screen.png', type = 'image/png') =>
  new File([new Uint8Array(size)], name, { type });

function intake(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Let engineers export a plan as PDF.',
    ticketUrl: 'https://tracker.example.com/browse/APP-12',
    attachments: [file(10)],
    exploreCodebase: true,
    researchTopics: ['PDF rendering in Node'],
    runMode: 'manual',
    repositoryIds: [ID],
    ...overrides,
  };
}

describe('FeatureCreateInput', () => {
  it('accepts a valid intake', () => {
    expect(FeatureCreateInput.safeParse(intake()).success).toBe(true);
  });

  it('accepts an intake with no ticket, attachments or topics', () => {
    const input = intake({ ticketUrl: undefined, attachments: [], researchTopics: [] });
    expect(FeatureCreateInput.safeParse(input).success).toBe(true);
  });

  it.each([
    ['an empty description', { description: '  ' }],
    ['a description over the cap', { description: 'x'.repeat(FEATURE_DESCRIPTION_MAX + 1) }],
    ['a non-https ticket link', { ticketUrl: 'http://tracker.example.com/APP-12' }],
    ['an empty file', { attachments: [file(0)] }],
    ['a file over 10 MiB', { attachments: [file(ATTACHMENT_BYTES_MAX + 1)] }],
    ['eleven attachments', { attachments: Array.from({ length: 11 }, () => file(1)) }],
    [
      'attachments over 25 MiB in total',
      { attachments: Array.from({ length: 3 }, () => file(ATTACHMENT_BYTES_MAX)) },
    ],
    ['an unlisted media type', { attachments: [file(1, 'run.sh', 'application/x-sh')] }],
    ['a file name over 200 characters', { attachments: [file(1, `${'a'.repeat(197)}.png`)] }],
    ['eleven research topics', { researchTopics: Array.from({ length: 11 }, () => 'topic') }],
    ['a blank research topic', { researchTopics: [' '] }],
    ['two repository ids', { repositoryIds: [ID, OTHER_ID] }],
    ['no repository id', { repositoryIds: [] }],
    ['an unknown run mode', { runMode: 'auto' }],
    ['an unknown key', { extra: true }],
  ])('rejects %s', (_name, overrides) => {
    expect(FeatureCreateInput.safeParse(intake(overrides)).success).toBe(false);
  });
});

const ASK = { findings: 'ask', rounds: { mode: 'ask' } };
const repository = { id: ID, owner: 'acme', name: 'app' };

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: 'Let engineers export a plan as PDF.',
    state: 'pre_planning',
    runMode: 'manual',
    createdAt: AT,
    description: 'Let engineers export a plan as PDF.',
    ticketUrl: null,
    exploreCodebase: true,
    workflowSettings: {
      decisions: 'ask',
      planCheckIn: 'pause',
      planReview: ASK,
      implementationReview: ASK,
    },
    repositories: [repository],
    attachments: [{ id: ID, name: 'screen.png', mediaType: 'image/png', sizeBytes: 10 }],
    tasks: [
      {
        id: ID,
        kind: 'intake',
        repository,
        topic: null,
        runId: ID,
        status: 'succeeded',
        commit: 'a'.repeat(40),
      },
    ],
    contextFiles: [{ id: ID, taskId: ID, title: 'Feature brief', ticked: true, updatedAt: AT }],
    updatedAt: AT,
    ...overrides,
  };
}

describe('FeatureDetail', () => {
  it('parses a detail', () => {
    expect(FeatureDetail.parse(detail())).toEqual(detail());
  });

  it('strips an unknown key', () => {
    expect(FeatureDetail.parse(detail({ authorId: ID }))).toEqual(detail());
  });
});

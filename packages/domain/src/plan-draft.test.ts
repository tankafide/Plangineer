import { type DraftStep, PlanBody, type PlanDraft, type SectionPatch } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { adoptDraft, mergeSection, replaceStep } from './plan-draft.ts';
import { idSource, planBodyFixture, uuid } from './test-fixtures.ts';

const OTHER_REPOSITORY_ID = '0199c1a2-7b3c-7d4e-8f90-000000000002';

const context = () => ({ repositoryId: OTHER_REPOSITORY_ID, newId: idSource() });

function draftFixture(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    goal: 'Export plans as PDF.',
    prerequisites: [{ id: 'new-p', item: 'A font licence', who: 'Engineer', status: 'open' }],
    steps: [
      {
        id: uuid(20),
        title: 'Render the PDF',
        files: ['apps/api/src/pdf.ts'],
        body: 'Render it.',
        doneWhen: [
          { id: uuid(21), text: 'A plan renders as a PDF.' },
          { id: 'new-line', text: 'A large plan renders.' },
        ],
      },
      {
        id: 'new-step',
        title: 'Email the PDF',
        files: [],
        body: '',
        doneWhen: [{ id: 'new-mail', text: 'The PDF arrives.' }],
      },
    ],
    decisions: [{ id: uuid(40), title: 'Server rendering', reason: 'Fonts match.', by: 'agent' }],
    constraints: [],
    coverage: [
      { lineId: uuid(21), ticks: ['unit'] },
      { lineId: 'new-line', ticks: ['integration'] },
      { lineId: 'new-mail', ticks: [] },
    ],
    blockers: [{ id: 'new-b', section: 'steps', stepId: 'new-step', text: 'Pick a mail service.' }],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

describe('adoptDraft', () => {
  const body = adoptDraft(draftFixture(), planBodyFixture(), context());

  it('keeps each id the base holds for an item of the same kind', () => {
    expect(body.steps[0]?.id).toBe(uuid(20));
    expect(body.steps[0]?.doneWhen[0]?.id).toBe(uuid(21));
    expect(body.decisions[0]?.id).toBe(uuid(40));
  });

  it('gives each new id a fresh one, in draft order', () => {
    expect(body.prerequisites[0]?.id).toBe(uuid(901));
    expect(body.steps[0]?.doneWhen[1]?.id).toBe(uuid(902));
    expect(body.steps[1]?.id).toBe(uuid(903));
    expect(body.steps[1]?.doneWhen[0]?.id).toBe(uuid(904));
    expect(body.blockers[0]?.id).toBe(uuid(905));
  });

  it('keeps coverage rows and blockers pointing at their renamed items', () => {
    expect(body.coverage.map((row) => row.lineId)).toEqual([uuid(21), uuid(902), uuid(904)]);
    expect(body.blockers[0]?.stepId).toBe(uuid(903));
  });

  it("sets the feature's repository on each step and clears every stale flag", () => {
    expect(body.steps.map((step) => step.repositoryId)).toEqual([
      OTHER_REPOSITORY_ID,
      OTHER_REPOSITORY_ID,
    ]);
    expect(body.coverage.map((row) => row.stale)).toEqual([false, false, false]);
  });

  it('makes a body the stored schema accepts', () => {
    expect(PlanBody.safeParse(body).success).toBe(true);
  });

  it('gives a fresh id to every item when there is no base', () => {
    const first = adoptDraft(draftFixture(), null, context());
    expect(first.steps[0]?.id).toBe(uuid(902));
    expect(first.coverage[0]?.lineId).toBe(first.steps[0]?.doneWhen[0]?.id);
  });

  it('gives a fresh id to a draft id that names an item of another kind in the base', () => {
    const draft = draftFixture({
      decisions: [{ id: uuid(30), title: 'Reused id', reason: 'A step id.', by: 'agent' }],
    });
    expect(adoptDraft(draft, planBodyFixture(), context()).decisions[0]?.id).not.toBe(uuid(30));
  });
});

const base = planBodyFixture({
  blockers: [
    { id: uuid(60), section: 'steps', stepId: uuid(30), text: 'Pick a button style.' },
    { id: uuid(61), section: 'goal', stepId: null, text: 'Name the audience.' },
  ],
});

const draftStep = (overrides: Partial<DraftStep> = {}): DraftStep => ({
  id: 'new-step',
  title: 'Render the PDF faster',
  files: ['apps/api/src/pdf.ts'],
  body: 'Stream it.',
  doneWhen: [{ id: 'new-line', text: 'A plan renders in a second.' }],
  ...overrides,
});

const PATCHES: [SectionPatch, keyof typeof base][] = [
  [{ section: 'goal', goal: 'A new goal.' }, 'goal'],
  [
    {
      section: 'prerequisites',
      prerequisites: [{ id: 'p', item: 'A licence', who: 'Ada', status: 'open' }],
    },
    'prerequisites',
  ],
  [
    { section: 'steps', steps: [draftStep({ id: uuid(20) }), draftStep({ id: uuid(30) })] },
    'steps',
  ],
  [{ section: 'decisions', decisions: [] }, 'decisions'],
  [
    { section: 'constraints', constraints: [{ id: 'c', title: 'T', target: 'A', check: 'B' }] },
    'constraints',
  ],
  [{ section: 'test_plan', coverage: [{ lineId: uuid(21), ticks: ['end_to_end'] }] }, 'coverage'],
  [
    {
      section: 'verification',
      verification: { automated: [], agentChecks: ['Look'], humanChecks: [] },
    },
    'verification',
  ],
];

describe('mergeSection', () => {
  it.each(PATCHES)('changes only the section of the patch %#', (patch, key) => {
    const merged = mergeSection(base, patch, context());
    expect(merged[key]).not.toEqual(base[key]);
    expect({ ...merged, [key]: base[key] }).toEqual(base);
  });

  it('adopts the ids of a patch against the base', () => {
    const patch: SectionPatch = { section: 'steps', steps: [draftStep({ id: uuid(20) })] };
    const [step] = mergeSection(base, patch, context()).steps;
    expect(step).toEqual({
      id: uuid(20),
      repositoryId: OTHER_REPOSITORY_ID,
      title: 'Render the PDF faster',
      files: ['apps/api/src/pdf.ts'],
      body: 'Stream it.',
      doneWhen: [{ id: uuid(901), text: 'A plan renders in a second.' }],
    });
  });

  it('drops the blockers of a step a steps patch removes, and keeps the rest', () => {
    const patch: SectionPatch = { section: 'steps', steps: [draftStep({ id: uuid(20) })] };
    expect(mergeSection(base, patch, context()).blockers).toEqual([base.blockers[1]]);
  });

  it('keeps the blockers of steps a steps patch keeps', () => {
    const patch: SectionPatch = { section: 'steps', steps: [draftStep({ id: uuid(30) })] };
    expect(mergeSection(base, patch, context()).blockers).toEqual(base.blockers);
  });

  it('keeps the line ids of a test plan patch and clears its stale flags', () => {
    const stale = planBodyFixture({
      coverage: base.coverage.map((row) => ({ ...row, stale: true })),
    });
    const patch: SectionPatch = {
      section: 'test_plan',
      coverage: [{ lineId: uuid(21), ticks: ['unit'] }],
    };
    expect(mergeSection(stale, patch, context()).coverage).toEqual([
      { lineId: uuid(21), ticks: ['unit'], stale: false },
    ]);
  });
});

describe('replaceStep', () => {
  it('replaces only the named step in place, keeping its id', () => {
    const step = draftStep({
      doneWhen: [
        { id: uuid(31), text: 'The button downloads the PDF.' },
        { id: 'new-line', text: 'The button shows progress.' },
      ],
    });
    const body = replaceStep(base, uuid(30), step, context());
    expect(body.steps).toEqual([
      base.steps[0],
      {
        id: uuid(30),
        repositoryId: OTHER_REPOSITORY_ID,
        title: 'Render the PDF faster',
        files: ['apps/api/src/pdf.ts'],
        body: 'Stream it.',
        doneWhen: [
          { id: uuid(31), text: 'The button downloads the PDF.' },
          { id: uuid(901), text: 'The button shows progress.' },
        ],
      },
    ]);
    expect({ ...body, steps: base.steps }).toEqual(base);
  });

  it('throws for a step the plan does not hold', () => {
    expect(() => replaceStep(base, uuid(99), draftStep(), context())).toThrow(
      `Step ${uuid(99)} is not in the plan`,
    );
  });
});

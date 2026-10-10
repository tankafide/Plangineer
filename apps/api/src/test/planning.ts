import { randomUUID } from 'node:crypto';
import type {
  PlanBody,
  PlanDecision,
  PlanDraft,
  PlanningJob,
  PlanningOutput,
  PlanRevisionSource,
  PlanStep,
  RunMode,
} from '@plangineer/contracts';
import { workflowSettingsFor } from '@plangineer/domain';
import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { planningTurns, planRevisions } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { TurnSpec } from '../planning/planning-inputs.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { insertRun } from '../runs/run-repository.ts';
import { appendRunnerEvents, planningOutputEvent, startedEvent, succeededEvent } from './runs.ts';

/** A ready body on the repository: two steps with files and lines, every row ticked. */
export function planBody(repositoryId: string, overrides: Partial<PlanBody> = {}): PlanBody {
  const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
  return {
    goal: 'Let engineers export a plan as PDF.',
    prerequisites: [],
    steps: [
      {
        id: randomUUID(),
        repositoryId,
        title: 'Render the PDF',
        files: ['apps/api/src/pdf.ts'],
        body: 'Render the plan.',
        doneWhen: [
          { id: first, text: 'A plan renders as a PDF.' },
          { id: second, text: 'An empty plan is refused.' },
        ],
      },
      {
        id: randomUUID(),
        repositoryId,
        title: 'Add the export button',
        files: ['apps/web/src/export.tsx'],
        body: 'A button on the plan screen.',
        doneWhen: [{ id: third, text: 'The button downloads the PDF.' }],
      },
    ],
    decisions: [
      { id: randomUUID(), title: 'Server rendering', reason: 'Fonts match.', by: 'agent' },
    ],
    constraints: [],
    coverage: [first, second, third].map((lineId) => ({ lineId, ticks: ['unit'], stale: false })),
    blockers: [],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

/** A body whose JSON is just under the given size, from steps with long bodies. */
export function planBodyOfSize(repositoryId: string, bytes: number): PlanBody {
  const base = planBody(repositoryId, { steps: [], coverage: [] });
  const step = (length: number): PlanStep => ({
    id: randomUUID(),
    repositoryId,
    title: 'Big step',
    files: ['apps/api/src/pdf.ts'],
    body: 'b'.repeat(length),
    doneWhen: [],
  });
  const steps: PlanStep[] = [];
  const size = () => JSON.stringify({ ...base, steps }).length;
  while (bytes - size() > JSON.stringify(step(0)).length + 1) {
    const room = bytes - size() - JSON.stringify(step(0)).length - 1;
    steps.push(step(Math.min(20_000, room)));
  }
  return { ...base, steps };
}

/** The feature's revisions, oldest first. */
export async function revisionsOf(db: Database, featureId: string) {
  return db
    .select()
    .from(planRevisions)
    .where(eq(planRevisions.featureId, featureId))
    .orderBy(asc(planRevisions.number));
}

/** A ready draft with the free-text ids an agent writes. */
export function planDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
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
    blockers: [],
    verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    ...overrides,
  };
}

export const questionsOutput = (count = 1): PlanningOutput => ({
  kind: 'questions',
  questions: Array.from({ length: count }, (_, index) => ({
    section: 'steps',
    prompt: `Which store? (${index + 1})`,
    choices: [
      { label: 'Postgres', detail: 'One database.' },
      { label: 'S3', detail: 'Cheaper for files.' },
    ],
    recommended: 0,
  })),
  decisions: [{ id: 'new-1', title: 'Server rendering', reason: 'Fonts match.', by: 'agent' }],
});

function testPlanningJob(spec: TurnSpec, runMode: RunMode): PlanningJob {
  return {
    kind: 'planning',
    turn: spec.kind,
    section: spec.kind === 'section_action' ? spec.section : null,
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'Plan the feature.',
    settings: workflowSettingsFor(runMode),
  };
}

/**
 * Queues a planning run on the runner and stores its turn directly, with no inputs rendered, and
 * with the given decisions as if its questions output were applied.
 */
export async function storeTurn(
  deps: ServiceDeps,
  {
    featureId,
    userId,
    runnerId,
    spec = { kind: 'guided' },
    decisions = null,
    runMode = 'manual',
  }: {
    featureId: string;
    userId: string;
    runnerId: string;
    spec?: TurnSpec;
    decisions?: PlanDecision[] | null;
    runMode?: RunMode;
  },
): Promise<{ turnId: string; runId: string }> {
  const job = testPlanningJob(spec, runMode);
  return deps.db.transaction(async (tx) => {
    const runId = await insertRun(tx, userId, {
      kind: 'planning',
      runnerId,
      repository: job.repository,
      ref: job.ref,
      prompt: job.prompt,
    });
    await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], {
      leaseDurationMs: deps.env.RUN_LEASE_DURATION_MS,
      logger: deps.logger,
    });
    const [row] = await tx
      .insert(planningTurns)
      .values({
        featureId,
        kind: spec.kind,
        section: spec.kind === 'section_action' ? spec.section : null,
        action: spec.kind === 'section_action' ? spec.action : null,
        stepId: spec.kind === 'revise_step' ? spec.stepId : null,
        instruction: spec.kind === 'revise_step' ? spec.instruction : null,
        job,
        inputs: '# Planning inputs',
        decisions,
        runId,
      })
      .returning({ id: planningTurns.id });
    if (row === undefined) throw new Error('Planning turn insert returned no row');
    return { turnId: row.id, runId };
  });
}

/** Inserts a revision row directly, as the engineer's unless a turn is given. */
export async function storeRevision(
  db: Database,
  {
    featureId,
    body,
    number,
    authorId = null,
    turnId = null,
  }: {
    featureId: string;
    body: PlanBody;
    number: number;
    authorId?: string | null;
    turnId?: string | null;
  },
): Promise<string> {
  const source: PlanRevisionSource = turnId === null ? 'engineer' : 'agent';
  const [row] = await db
    .insert(planRevisions)
    .values({ featureId, number, body, source, turnId, authorId })
    .returning({ id: planRevisions.id });
  if (row === undefined) throw new Error('Plan revision insert returned no row');
  return row.id;
}

/** The feature's newest turn with its job and inputs. */
export async function latestTurn(db: Database, featureId: string) {
  const [row] = await db
    .select()
    .from(planningTurns)
    .where(eq(planningTurns.featureId, featureId))
    .orderBy(desc(planningTurns.id))
    .limit(1);
  if (row === undefined) throw new Error(`Feature ${featureId} has no turn`);
  return row;
}

/** Claims the runner's queued runs and has the run start, write the output and succeed. */
export async function finishTurn(
  deps: ServiceDeps,
  runnerId: string,
  runId: string,
  output: PlanningOutput,
) {
  await claimRuns(deps, runnerId);
  return appendRunnerEvents(deps, runId, [
    startedEvent,
    planningOutputEvent(output),
    succeededEvent,
  ]);
}

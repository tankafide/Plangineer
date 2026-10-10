import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLAN_QUESTIONS_IN_INPUTS, PlanningJob, type RunMode } from '@plangineer/contracts';
import { workflowSettingsFor } from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import { PACKAGE_ROOT } from '../package-root.ts';
import { type AppendOptions, appendRunEvents } from '../runs/run-events-repository.ts';
import { insertRun } from '../runs/run-repository.ts';
import { renderPlanningInputs, type TurnSpec } from './planning-inputs.ts';
import {
  findFirstPlanningCommit,
  findPlanningSubject,
  insertTurn,
  listTickedContextFiles,
} from './planning-repository.ts';
import { readPlanState } from './plan-state.ts';
import { listAnsweredQuestions } from './question-repository.ts';

let planningPrompt: string | undefined;

/** The planning agent's prompt, which takes no variables. */
export function renderPlanningPrompt(): string {
  planningPrompt ??= readFileSync(
    path.join(PACKAGE_ROOT, 'src', 'planning', 'templates', 'planning-prompt.md'),
    'utf8',
  ).replaceAll('\r\n', '\n');
  return planningPrompt;
}

export interface TurnFeature {
  id: string;
  authorId: string;
  runMode: RunMode;
}

/**
 * Queues one planning turn: renders its inputs and job, inserts a planning run on the runner with
 * run.queued, and inserts the turn with the context files it read. It checks out the commit the
 * feature's first planning run recorded, or the default branch before one has (D7), and its job
 * carries the run mode's settings (D4). The caller holds the feature lock and wakes the runner
 * after the commit.
 */
export async function queueTurn(
  tx: Transaction,
  options: AppendOptions,
  feature: TurnFeature,
  spec: TurnSpec,
  runnerId: string,
): Promise<void> {
  const subject = await findPlanningSubject(tx, feature.id);
  if (subject === undefined) throw new Error(`Feature ${feature.id} has no repository`);
  const files = await listTickedContextFiles(tx, feature.id);
  const questions = await listAnsweredQuestions(tx, feature.id, PLAN_QUESTIONS_IN_INPUTS);
  const state = await readPlanState(tx, feature.id);
  const firstCommit = await findFirstPlanningCommit(tx, feature.id);
  const repository = { owner: subject.repository.owner, name: subject.repository.name };
  const ref = firstCommit ?? subject.repository.defaultBranch;
  const inputs = renderPlanningInputs({
    spec,
    feature: { title: subject.title, description: subject.description },
    repository,
    ref,
    contextFiles: files,
    questions,
    decisions: state.decisions,
    plan: state.revision === undefined ? null : state.revision.body,
  });
  const job = PlanningJob.parse({
    kind: 'planning',
    turn: spec.kind,
    section: spec.kind === 'section_action' ? spec.section : null,
    repository,
    ref,
    prompt: renderPlanningPrompt(),
    settings: workflowSettingsFor(feature.runMode),
  });
  const runId = await insertRun(tx, feature.authorId, {
    kind: 'planning',
    runnerId,
    repository,
    ref,
    prompt: job.prompt,
  });
  await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], options);
  await insertTurn(
    tx,
    {
      featureId: feature.id,
      kind: spec.kind,
      section: spec.kind === 'section_action' ? spec.section : null,
      action: spec.kind === 'section_action' ? spec.action : null,
      stepId: spec.kind === 'revise_step' ? spec.stepId : null,
      instruction: spec.kind === 'revise_step' ? spec.instruction : null,
      job,
      inputs,
      runId,
    },
    files,
  );
}

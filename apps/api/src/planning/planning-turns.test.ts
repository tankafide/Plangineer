import { call } from '@orpc/server';
import { PlanBody, PlanningOutput } from '@plangineer/contracts';
import { workflowSettingsFor } from '@plangineer/domain';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contextFiles, planningTurnContextFiles, planQuestions } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  finishTurn,
  latestTurn,
  planBody,
  planDraft,
  storeRevision,
  storeTurn,
} from '../test/planning.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { queueTurn, renderPlanningPrompt } from './planning-turns.ts';

const label = (n: number) => `Q${String(n).padStart(3, '0')}`;

describe('renderPlanningPrompt', () => {
  it('names the inputs, the output, the plan-orchestrator skill, the three turn kinds and the stop rule', () => {
    const prompt = renderPlanningPrompt();

    for (const part of [
      '.plangineer-task/inputs.md',
      '.plangineer-task/output.json',
      '.agents/skills/plan-orchestrator/SKILL.md',
      '`guided`',
      '`section_action`',
      '`revise_step`',
      '## Stop rule',
      'Never guess.',
    ]) {
      expect(prompt).toContain(part);
    }
  });
});

describe('queueTurn', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    const admin = await storeUser(testAuth(database.db), { role: 'admin' });
    repositoryId = await storeRepository(database.db, { createdBy: admin.id });
  });

  afterAll(async () => {
    await database.drop();
  });

  async function viewer() {
    const stored = await storeUser(testAuth(database.db), { role: 'member' });
    const runnerId = await storeRunner(database.db, { userId: stored.id, concurrencyLimit: 16 });
    const context: InitialContext = {
      ...deps,
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, runnerId, context };
  }

  /** One ticked and one unticked context file of the feature. */
  async function contextFilesOf(featureId: string, userId: string, runnerId: string) {
    const files = [];
    for (const [title, ticked] of [
      ['Ticked brief', true],
      ['Unticked research', false],
    ] as const) {
      const { taskId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
      const [file] = await database.db
        .insert(contextFiles)
        .values({ taskId, title, content: `Content of ${title}`, ticked })
        .returning({ id: contextFiles.id });
      files.push(file?.id);
    }
    return files;
  }

  /** 41 answered questions over nine turns, numbered in the order they were asked. */
  async function answeredQuestions(featureId: string, userId: string, runnerId: string) {
    for (let turn = 0; turn < 9; turn += 1) {
      const { turnId } = await storeTurn(deps, { featureId, userId, runnerId, decisions: [] });
      const positions = Array.from({ length: turn === 8 ? 1 : 5 }, (_, position) => position);
      await database.db.insert(planQuestions).values(
        positions.map((position) => {
          const n = turn * 5 + position + 1;
          return {
            turnId,
            position,
            section: 'steps' as const,
            prompt: `${label(n)} prompt`,
            choices: [
              { label: 'Postgres', detail: 'One database.' },
              { label: 'S3', detail: 'Files.' },
            ],
            recommended: 0,
            answerText: `${label(n)} answer`,
            answeredAt: new Date(),
          };
        }),
      );
    }
  }

  it('renders the ticked files, the latest 40 answers, the decisions, the plan and the schema, each fenced', async () => {
    const { userId, runnerId } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'planning',
    });
    await contextFilesOf(featureId, userId, runnerId);
    await answeredQuestions(featureId, userId, runnerId);
    const body = planBody(repositoryId);
    await storeRevision(database.db, { featureId, body, number: 1, authorId: userId });

    await database.db.transaction((tx) =>
      queueTurn(
        tx,
        { leaseDurationMs: deps.env.RUN_LEASE_DURATION_MS, logger: deps.logger },
        { id: featureId, authorId: userId, runMode: 'manual' },
        { kind: 'guided' },
        runnerId,
      ),
    );

    const { inputs } = await latestTurn(database.db, featureId);
    expect(inputs).toContain('```text\nContent of Ticked brief\n```');
    expect(inputs).not.toContain('Unticked research');
    expect(inputs).not.toContain(label(1));
    expect(inputs.indexOf(`${label(2)} prompt`)).toBeLessThan(
      inputs.indexOf(`${label(41)} prompt`),
    );
    expect(inputs).toContain(`Answer: ${label(41)} answer`);
    expect(inputs).toContain(
      '## Decisions so far\n\n```text\n- Server rendering (by agent): Fonts match.\n```',
    );
    expect(inputs).toContain(
      `## Current plan\n\n\`\`\`text\n${JSON.stringify(PlanBody.parse(body))}\n\`\`\``,
    );
    expect(inputs).toContain(
      `## Output schema\n\n\`\`\`text\n${JSON.stringify(z.toJSONSchema(PlanningOutput))}\n\`\`\``,
    );
    for (const heading of ['Turn', 'Repository', 'Readiness']) {
      expect(inputs).toContain(`## ${heading}\n\n\`\`\`text\n`);
    }
  });

  it("checks a second turn out at the first run's commit, with the run mode's settings and the files it read", async () => {
    const { userId, runnerId, context } = await viewer();
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'plan_ready',
      runMode: 'manual_plan',
    });
    const [ticked] = await contextFilesOf(featureId, userId, runnerId);
    await call(router.feature.startPlanning, { featureId }, { context });
    const first = await latestTurn(database.db, featureId);
    await finishTurn(deps, runnerId, first.runId, { kind: 'plan', plan: planDraft() });

    await call(router.plan.continue, { featureId }, { context });

    const second = await latestTurn(database.db, featureId);
    const read = await database.db
      .select({
        contextFileId: planningTurnContextFiles.contextFileId,
        title: planningTurnContextFiles.title,
      })
      .from(planningTurnContextFiles)
      .where(eq(planningTurnContextFiles.turnId, second.id))
      .orderBy(asc(planningTurnContextFiles.id));
    expect(first.job.ref).toBe('main');
    expect(second.job).toMatchObject({
      ref: 'a'.repeat(40),
      settings: workflowSettingsFor('manual_plan'),
    });
    expect(read).toEqual([{ contextFileId: ticked, title: 'Ticked brief' }]);
  });
});

import type { Context } from 'hono';
import { z } from 'zod';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { getPlanningInputsForRunner } from '../planning/plan-service.ts';
import { authenticateRunner } from './runner-auth.ts';

const RunId = z.uuid();

/**
 * Serves a planning run's inputs to the runner holding the run leased or running. A bad token
 * answers 401, and every other refusal answers 404, so a runner learns nothing about runs it
 * may not read.
 */
export function runnerPlanningInputsRoute(deps: ServiceDeps) {
  return async (c: Context) => {
    const runner = await authenticateRunner(deps.db, c.req.header('authorization'));
    if (runner === undefined) return c.text('Unauthorized', 401);
    const runId = RunId.safeParse(c.req.param('runId'));
    const inputs = runId.success
      ? await getPlanningInputsForRunner(deps, runner.id, runId.data)
      : undefined;
    if (inputs === undefined) return c.text('Not Found', 404);
    return c.body(inputs, 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
    });
  };
}

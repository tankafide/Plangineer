import { featureStateAfterTasks } from '@plangineer/domain';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { startAutoPlanning } from './feature-service.ts';
import {
  findFeatureIdOfRun,
  listTaskRunStatuses,
  lockFeature,
  updateFeatureState,
} from './feature-repository.ts';

/**
 * Moves the feature to plan ready once every task's run has ended, under the feature's row lock,
 * then starts an Auto loop feature's planning. It is idempotent and never throws, since run ends
 * and the sweeper call it and must carry on: a failure is logged, and the next sweep retries it.
 */
export async function advanceFeature(deps: ServiceDeps, featureId: string): Promise<void> {
  try {
    const planReady = await deps.db.transaction(async (tx) => {
      const feature = await lockFeature(tx, featureId);
      if (feature === undefined) return false;
      const next = featureStateAfterTasks(feature.state, await listTaskRunStatuses(tx, featureId));
      if (next === feature.state) return false;
      await updateFeatureState(tx, featureId, next);
      return next === 'plan_ready';
    });
    if (planReady) await startAutoPlanning(deps, featureId);
  } catch (error) {
    deps.logger.error({ err: error, featureId }, 'Feature could not advance after its tasks');
  }
}

/** Advances the feature a pre-planning run serves, after the run ended. It never throws. */
export async function advancePrePlanningOfRun(deps: ServiceDeps, runId: string): Promise<void> {
  try {
    const featureId = await findFeatureIdOfRun(deps.db, runId);
    if (featureId !== undefined) await advanceFeature(deps, featureId);
  } catch (error) {
    deps.logger.error({ err: error, runId }, 'Feature could not advance after its run ended');
  }
}

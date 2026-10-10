import { advancePrePlanningOfRun } from '../features/feature-advance.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { advanceSetupOfRun } from '../setup/setup-advance.ts';

/**
 * Moves whatever a run serves once it has ended: its repository setup or its feature. Every
 * path that ends a run calls it after its transaction, and it never throws.
 */
export async function onRunEnded(deps: ServiceDeps, runId: string): Promise<void> {
  await advanceSetupOfRun(deps, runId);
  await advancePrePlanningOfRun(deps, runId);
}

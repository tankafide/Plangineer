import type { PlanBody } from '@plangineer/contracts';
import { alignCoverage, markStale } from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import {
  findLatestRevision,
  findRevisionSources,
  insertRevision,
  insertRevisionSources,
  listTurnContextFiles,
} from './revision-repository.ts';

/**
 * Who made a revision. An agent's revision was built from its turn's context files at its run's
 * commit, and `rewroteCoverage` says the agent wrote the coverage with the steps in view (D8).
 */
export type RevisionMeta =
  | {
      source: 'agent';
      turnId: string;
      repositoryId: string;
      commit: string;
      rewroteCoverage: boolean;
    }
  | { source: 'engineer'; authorId: string };

/**
 * The one way a revision is made: inserts the next number with the body's coverage aligned and,
 * unless the agent rewrote the coverage, the rows of changed steps marked stale against the
 * latest body. An engineer's revision keeps the previous revision's context files and base
 * commits. Returns the stored body.
 */
export async function storeRevision(
  tx: Transaction,
  featureId: string,
  body: PlanBody,
  meta: RevisionMeta,
): Promise<PlanBody> {
  const latest = await findLatestRevision(tx, featureId);
  const aligned = alignCoverage(body);
  const stored =
    meta.source === 'agent' && meta.rewroteCoverage
      ? aligned
      : markStale(latest === undefined ? null : latest.body, aligned);
  const revisionId = await insertRevision(tx, {
    featureId,
    number: latest === undefined ? 1 : latest.number + 1,
    body: stored,
    author:
      meta.source === 'agent'
        ? { source: 'agent', turnId: meta.turnId }
        : { source: 'engineer', authorId: meta.authorId },
  });
  if (meta.source === 'agent') {
    await insertRevisionSources(tx, revisionId, {
      contextFiles: await listTurnContextFiles(tx, meta.turnId),
      baseCommits: [{ repositoryId: meta.repositoryId, commit: meta.commit }],
    });
  } else {
    if (latest === undefined) throw new Error(`Feature ${featureId} has no revision to edit`);
    await insertRevisionSources(tx, revisionId, await findRevisionSources(tx, latest.id));
  }
  return stored;
}

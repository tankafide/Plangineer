import { CliStatus, type PageInput, Runner, type RunnerPlatform } from '@plangineer/contracts';
import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { toIsoOrNull } from '../lib/dates.ts';
import { runners } from '../db/schema.ts';
import { RUNNER_WAKE_CHANNEL } from '../realtime/notifications.ts';

/** True while the runner was seen within the offline window, by the database clock. */
export function runnerOnline(offlineAfterMs: number): SQL<boolean> {
  return sql<boolean>`coalesce(${runners.lastSeenAt} > now() - make_interval(secs => ${offlineAfterMs / 1000}), false)`;
}

function runnerColumns(offlineAfterMs: number) {
  return {
    id: runners.id,
    name: runners.name,
    platform: runners.platform,
    status: runners.status,
    online: runnerOnline(offlineAfterMs),
    lastSeenAt: runners.lastSeenAt,
    planLimitResetsAt: runners.planLimitResetsAt,
    concurrencyLimit: runners.concurrencyLimit,
    clis: runners.clis,
    createdAt: runners.createdAt,
    revokedAt: runners.revokedAt,
  };
}

interface RunnerRow {
  id: string;
  name: string;
  platform: RunnerPlatform;
  status: Runner['status'];
  online: boolean;
  lastSeenAt: Date | null;
  planLimitResetsAt: Date | null;
  concurrencyLimit: number | null;
  clis: unknown;
  createdAt: Date;
  revokedAt: Date | null;
}

function toRunner(row: RunnerRow): Runner {
  return Runner.parse({
    ...row,
    lastSeenAt: toIsoOrNull(row.lastSeenAt),
    planLimitResetsAt: toIsoOrNull(row.planLimitResetsAt),
    createdAt: row.createdAt.toISOString(),
    revokedAt: toIsoOrNull(row.revokedAt),
    clis: CliStatus.array().parse(row.clis),
  });
}

export async function insertRunner(
  tx: Transaction,
  values: { userId: string; name: string; platform: RunnerPlatform; tokenHash: string },
): Promise<string> {
  const [row] = await tx.insert(runners).values(values).returning({ id: runners.id });
  if (row === undefined) throw new Error('Runner insert returned no row');
  return row.id;
}

/** One page of the user's runners, id descending, with one extra row to tell if more exist. */
export async function listRunnersForUser(
  executor: Executor,
  userId: string,
  { cursor, limit }: PageInput,
  offlineAfterMs: number,
): Promise<Runner[]> {
  const rows = await executor
    .select(runnerColumns(offlineAfterMs))
    .from(runners)
    .where(
      and(eq(runners.userId, userId), cursor === undefined ? undefined : lt(runners.id, cursor)),
    )
    .orderBy(desc(runners.id))
    .limit(limit + 1);
  return rows.map(toRunner);
}

export async function findRunnerForUser(
  executor: Executor,
  userId: string,
  runnerId: string,
  offlineAfterMs: number,
): Promise<Runner | undefined> {
  const [row] = await executor
    .select(runnerColumns(offlineAfterMs))
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.userId, userId)));
  return row === undefined ? undefined : toRunner(row);
}

/** The most a user's active runners list holds when a runner is picked for them. */
const RUNNER_CANDIDATES_MAX = 100;

/**
 * The user's active runners, each with when it was last seen, to pick one for new work. They
 * come most recently seen first, so the limit never drops the runner the pick wants.
 */
export async function listActiveRunnersForUser(
  executor: Executor,
  userId: string,
): Promise<{ id: string; status: Runner['status']; lastSeenAt: string | null }[]> {
  const rows = await executor
    .select({ id: runners.id, status: runners.status, lastSeenAt: runners.lastSeenAt })
    .from(runners)
    .where(and(eq(runners.userId, userId), eq(runners.status, 'active')))
    .orderBy(sql`${runners.lastSeenAt} DESC NULLS LAST`, asc(runners.id))
    .limit(RUNNER_CANDIDATES_MAX);
  return rows.map((row) => ({ ...row, lastSeenAt: toIsoOrNull(row.lastSeenAt) }));
}

/** Locks the user's runner row, so claims and revokes on it run one at a time. */
export async function lockRunnerForUser(
  tx: Transaction,
  userId: string,
  runnerId: string,
): Promise<{ status: Runner['status'] } | undefined> {
  const [row] = await tx
    .select({ status: runners.status })
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.userId, userId)))
    .for('update');
  return row;
}

/**
 * Share-locks the runner row unless another transaction holds it, such as a revoke, so work
 * queued under the lock orders before that transaction or is not queued at all.
 */
export async function shareRunnerUnlessLocked(
  tx: Transaction,
  runnerId: string,
): Promise<{ status: Runner['status'] } | undefined> {
  const [row] = await tx
    .select({ status: runners.status })
    .from(runners)
    .where(eq(runners.id, runnerId))
    .for('share', { skipLocked: true });
  return row;
}

export async function markRunnerRevoked(tx: Transaction, runnerId: string): Promise<void> {
  await tx
    .update(runners)
    .set({ status: 'revoked', revokedAt: sql`now()` })
    .where(and(eq(runners.id, runnerId), eq(runners.status, 'active')));
}

export async function findActiveRunnerByTokenHash(
  executor: Executor,
  tokenHash: string,
): Promise<{ id: string } | undefined> {
  const [row] = await executor
    .select({ id: runners.id })
    .from(runners)
    .where(and(eq(runners.tokenHash, tokenHash), eq(runners.status, 'active')));
  return row;
}

export async function findRunnerStatus(
  executor: Executor,
  runnerId: string,
): Promise<Runner['status'] | undefined> {
  const [row] = await executor
    .select({ status: runners.status })
    .from(runners)
    .where(eq(runners.id, runnerId));
  return row?.status;
}

export async function recordRunnerHello(
  executor: Executor,
  runnerId: string,
  hello: { concurrencyLimit: number; runnerVersion: string; clis: CliStatus[] },
): Promise<void> {
  await executor
    .update(runners)
    .set({ ...hello, clis: CliStatus.array().parse(hello.clis), lastSeenAt: sql`now()` })
    .where(eq(runners.id, runnerId));
}

export async function recordRunnerSeen(executor: Executor, runnerId: string): Promise<void> {
  await executor
    .update(runners)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(runners.id, runnerId));
}

export async function recordPlanLimit(
  executor: Executor,
  runnerId: string,
  resetsAt: Date | null,
): Promise<void> {
  await executor
    .update(runners)
    .set({ planLimitResetsAt: resetsAt })
    .where(eq(runners.id, runnerId));
}

/** Tells the API process holding the runner's socket to dispatch, cancel or close it. */
export async function wakeRunner(executor: Executor, runnerId: string): Promise<void> {
  await executor.execute(sql`SELECT pg_notify(${RUNNER_WAKE_CHANNEL}, ${runnerId})`);
}

export interface ClaimableRunner {
  status: Runner['status'];
  online: boolean;
  concurrencyLimit: number | null;
  planLimited: boolean;
}

/** Locks the runner row, which serializes claims for one runner. */
export async function lockRunnerForClaim(
  tx: Transaction,
  runnerId: string,
  offlineAfterMs: number,
): Promise<ClaimableRunner | undefined> {
  const [row] = await tx
    .select({
      status: runners.status,
      online: runnerOnline(offlineAfterMs),
      concurrencyLimit: runners.concurrencyLimit,
      planLimited: sql<boolean>`coalesce(${runners.planLimitResetsAt} > now(), false)`,
    })
    .from(runners)
    .where(eq(runners.id, runnerId))
    .for('update');
  return row;
}

/** Stores the agent CLIs a connected runner reports after its hello. */
export async function recordRunnerClis(
  executor: Executor,
  runnerId: string,
  clis: CliStatus[],
): Promise<void> {
  await executor
    .update(runners)
    .set({ clis: CliStatus.array().parse(clis), lastSeenAt: sql`now()` })
    .where(eq(runners.id, runnerId));
}

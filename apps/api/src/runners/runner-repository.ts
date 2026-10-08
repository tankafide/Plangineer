import { CliStatus, type PageInput, Runner, type RunnerPlatform } from '@plangineer/contracts';
import { and, desc, eq, gt, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { runnerPairingCodes, runners } from '../db/schema.ts';
import { RUNNER_WAKE_CHANNEL } from '../realtime/notifications.ts';

/** True while the runner was seen within the offline window, by the database clock. */
export function runnerOnline(offlineAfterMs: number): SQL<boolean> {
  return sql<boolean>`coalesce(${runners.lastSeenAt} > now() - make_interval(secs => ${offlineAfterMs / 1000}), false)`;
}

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

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
    lastSeenAt: iso(row.lastSeenAt),
    planLimitResetsAt: iso(row.planLimitResetsAt),
    createdAt: row.createdAt.toISOString(),
    revokedAt: iso(row.revokedAt),
    clis: CliStatus.array().parse(row.clis),
  });
}

export async function countPairingCodesSince(
  tx: Transaction,
  userId: string,
  windowMs: number,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(runnerPairingCodes)
    .where(
      and(
        eq(runnerPairingCodes.userId, userId),
        gt(runnerPairingCodes.createdAt, sql`now() - make_interval(secs => ${windowMs / 1000})`),
      ),
    );
  return row?.count ?? 0;
}

export async function insertPairingCode(
  tx: Transaction,
  { userId, codeHash, ttlMs }: { userId: string; codeHash: string; ttlMs: number },
): Promise<Date> {
  const [row] = await tx
    .insert(runnerPairingCodes)
    .values({
      userId,
      codeHash,
      expiresAt: sql`now() + make_interval(secs => ${ttlMs / 1000})`,
    })
    .returning({ expiresAt: runnerPairingCodes.expiresAt });
  if (row === undefined) throw new Error('Pairing code insert returned no row');
  return row.expiresAt;
}

/** Marks an unused, unexpired code used and returns its user, or undefined for any other code. */
export async function usePairingCode(
  tx: Transaction,
  codeHash: string,
): Promise<string | undefined> {
  const [row] = await tx
    .update(runnerPairingCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(runnerPairingCodes.codeHash, codeHash),
        isNull(runnerPairingCodes.usedAt),
        gt(runnerPairingCodes.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: runnerPairingCodes.userId });
  return row?.userId;
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

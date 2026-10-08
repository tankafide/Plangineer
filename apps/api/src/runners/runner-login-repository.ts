import type { RunnerLoginStatus, RunnerPlatform } from '@plangineer/contracts';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { runnerLogins } from '../db/schema.ts';

export interface RunnerLoginRow {
  id: string;
  name: string;
  platform: RunnerPlatform;
  status: RunnerLoginStatus;
  userId: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** By the database clock, so a test can move a login request into the past. */
  expired: boolean;
}

const loginColumns = {
  id: runnerLogins.id,
  name: runnerLogins.name,
  platform: runnerLogins.platform,
  status: runnerLogins.status,
  userId: runnerLogins.userId,
  createdAt: runnerLogins.createdAt,
  expiresAt: runnerLogins.expiresAt,
  expired: sql<boolean>`${runnerLogins.expiresAt} <= now()`,
};

/** Serializes the cap check and the insert, so two starts at once cannot both pass the count. */
export async function lockRunnerLoginStarts(tx: Transaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('runner-logins', 0))`);
}

export async function deleteLoginsExpiredBefore(tx: Transaction, graceMs: number): Promise<void> {
  await tx
    .delete(runnerLogins)
    .where(lt(runnerLogins.expiresAt, sql`now() - make_interval(secs => ${graceMs / 1000})`));
}

export async function countPendingLogins(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(runnerLogins)
    .where(and(eq(runnerLogins.status, 'pending'), gt(runnerLogins.expiresAt, sql`now()`)));
  return row?.count ?? 0;
}

export async function insertLogin(
  tx: Transaction,
  values: {
    deviceSecretHash: string;
    userCodeHash: string;
    name: string;
    platform: RunnerPlatform;
    ttlMs: number;
  },
): Promise<Date> {
  const { ttlMs, ...columns } = values;
  const [row] = await tx
    .insert(runnerLogins)
    .values({ ...columns, expiresAt: sql`now() + make_interval(secs => ${ttlMs / 1000})` })
    .returning({ expiresAt: runnerLogins.expiresAt });
  if (row === undefined) throw new Error('Runner login insert returned no row');
  return row.expiresAt;
}

/** The unexpired login request a user code names. */
export async function findLiveLoginByUserCodeHash(
  executor: Executor,
  userCodeHash: string,
): Promise<RunnerLoginRow | undefined> {
  const [row] = await executor
    .select(loginColumns)
    .from(runnerLogins)
    .where(
      and(eq(runnerLogins.userCodeHash, userCodeHash), gt(runnerLogins.expiresAt, sql`now()`)),
    );
  return row;
}

/** Locks the unexpired login request a user code names, so decisions on it run one at a time. */
export async function lockLiveLoginByUserCodeHash(
  tx: Transaction,
  userCodeHash: string,
): Promise<RunnerLoginRow | undefined> {
  const [row] = await tx
    .select(loginColumns)
    .from(runnerLogins)
    .where(and(eq(runnerLogins.userCodeHash, userCodeHash), gt(runnerLogins.expiresAt, sql`now()`)))
    .for('update');
  return row;
}

/** Locks the login request a device secret names, so overlapping polls complete it once. */
export async function lockLoginByDeviceSecretHash(
  tx: Transaction,
  deviceSecretHash: string,
): Promise<RunnerLoginRow | undefined> {
  const [row] = await tx
    .select(loginColumns)
    .from(runnerLogins)
    .where(eq(runnerLogins.deviceSecretHash, deviceSecretHash))
    .for('update');
  return row;
}

export async function setLoginDecision(
  tx: Transaction,
  loginId: string,
  decision: { status: 'approved'; userId: string } | { status: 'denied' },
): Promise<void> {
  await tx
    .update(runnerLogins)
    .set(
      decision.status === 'approved'
        ? { status: 'approved', userId: decision.userId }
        : { status: 'denied' },
    )
    .where(eq(runnerLogins.id, loginId));
}

export async function setLoginCompleted(
  tx: Transaction,
  loginId: string,
  runnerId: string,
): Promise<void> {
  await tx
    .update(runnerLogins)
    .set({ status: 'completed', runnerId })
    .where(eq(runnerLogins.id, loginId));
}

import type { PageInput, Runner, RunnerPlatform } from '@plangineer/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { toPage } from '../lib/page.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { lockOpenRunsOfRunner } from '../runs/run-repository.ts';
import {
  generatePairingCode,
  generateRunnerToken,
  hashSecret,
  normalizePairingCode,
  PAIRING_CODE_LIMIT,
  PAIRING_CODE_WINDOW_MS,
} from './pairing.ts';
import {
  countPairingCodesSince,
  findActiveRunnerByTokenHash,
  findRunnerForUser,
  insertPairingCode,
  insertRunner,
  listRunnersForUser,
  lockRunnerForUser,
  markRunnerRevoked,
  usePairingCode,
  wakeRunner,
} from './runner-repository.ts';

/** Issues a one-time pairing code, returned this once and stored only as a hash. */
export async function createPairingCode(
  { db, env }: ServiceDeps,
  userId: string,
): Promise<Result<{ code: string; expiresAt: string }, 'TOO_MANY_REQUESTS'>> {
  const code = generatePairingCode();
  return db.transaction(async (tx) => {
    // Serializes one user's requests, so two at once cannot both pass the count.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pairing:${userId}`}, 0))`,
    );
    const recent = await countPairingCodesSince(tx, userId, PAIRING_CODE_WINDOW_MS);
    if (recent >= PAIRING_CODE_LIMIT) return fail('TOO_MANY_REQUESTS');
    const expiresAt = await insertPairingCode(tx, {
      userId,
      codeHash: hashSecret(normalizePairingCode(code)),
      ttlMs: env.RUNNER_PAIRING_CODE_TTL_MS,
    });
    return ok({ code, expiresAt: expiresAt.toISOString() });
  });
}

/**
 * Exchanges an unused, unexpired code for a new runner and its token, shown this once. A
 * missing, used or expired code gets the same answer, so the error tells a guesser nothing.
 */
export async function pairRunner(
  { db }: ServiceDeps,
  input: { code: string; name: string; platform: RunnerPlatform },
): Promise<Result<{ runnerId: string; token: string }, 'PAIRING_CODE_REJECTED'>> {
  const token = generateRunnerToken();
  return db.transaction(async (tx) => {
    const userId = await usePairingCode(tx, hashSecret(normalizePairingCode(input.code)));
    if (userId === undefined) return fail('PAIRING_CODE_REJECTED');
    const runnerId = await insertRunner(tx, {
      userId,
      name: input.name,
      platform: input.platform,
      tokenHash: hashSecret(token),
    });
    return ok({ runnerId, token });
  });
}

export async function listRunners({ db, env }: ServiceDeps, userId: string, page: PageInput) {
  const rows = await listRunnersForUser(db, userId, page, env.RUNNER_OFFLINE_AFTER_MS);
  return toPage(rows, page.limit);
}

/**
 * Revokes the runner and cancels its open runs. A wake tells the process holding its socket
 * to close it, and its late events reach runs that have already ended.
 */
export async function revokeRunner(
  { db, env, logger }: ServiceDeps,
  userId: string,
  runnerId: string,
): Promise<Result<Runner, 'NOT_FOUND'>> {
  return db.transaction(async (tx) => {
    const locked = await lockRunnerForUser(tx, userId, runnerId);
    if (locked === undefined) return fail('NOT_FOUND');
    if (locked.status === 'active') {
      await markRunnerRevoked(tx, runnerId);
      for (const runId of await lockOpenRunsOfRunner(tx, runnerId)) {
        await appendRunEvents(
          tx,
          runId,
          [{ body: { type: 'run.cancelled', reason: 'runner_revoked' } }],
          { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger },
        );
      }
      await wakeRunner(tx, runnerId);
    }
    const runner = await findRunnerForUser(tx, userId, runnerId, env.RUNNER_OFFLINE_AFTER_MS);
    if (runner === undefined) throw new Error(`Runner ${runnerId} vanished under its lock`);
    return ok(runner);
  });
}

/** The active runner a token belongs to, looked up by the token's hash. */
export async function findRunnerByToken(
  db: Database,
  token: string,
): Promise<{ id: string } | undefined> {
  return findActiveRunnerByTokenHash(db, hashSecret(token));
}

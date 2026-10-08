import type {
  RunnerLogin,
  RunnerPlatform,
  RunnerPollLoginOutput,
  RunnerStartLoginOutput,
} from '@plangineer/contracts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import {
  generateDeviceSecret,
  generateRunnerToken,
  generateUserCode,
  hashSecret,
  normalizeUserCode,
} from './pairing.ts';
import {
  countPendingLogins,
  deleteLoginsExpiredBefore,
  findLiveLoginByUserCodeHash,
  insertLogin,
  lockLiveLoginByUserCodeHash,
  lockLoginByDeviceSecretHash,
  lockRunnerLoginStarts,
  type RunnerLoginRow,
  setLoginCompleted,
  setLoginDecision,
} from './runner-login-repository.ts';
import { insertRunner } from './runner-repository.ts';

/** At most this many unexpired login requests may wait for approval. */
const PENDING_LOGIN_LIMIT = 200;
/** An expired login request is kept this long, then deleted by the next start. */
const EXPIRED_LOGIN_RETENTION_MS = 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

const hashUserCode = (userCode: string) => hashSecret(normalizeUserCode(userCode));

function toRunnerLogin(row: RunnerLoginRow, status = row.status): RunnerLogin {
  return {
    name: row.name,
    platform: row.platform,
    status: status === 'completed' ? 'approved' : status,
    requestedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Starts a login request for a runner. The device secret and user code are returned this once
 * and stored only as hashes. A cap on unexpired pending requests bounds this public procedure.
 */
export async function startLogin(
  { db, env }: ServiceDeps,
  input: { name: string; platform: RunnerPlatform },
): Promise<Result<RunnerStartLoginOutput, 'TOO_MANY_REQUESTS'>> {
  const deviceSecret = generateDeviceSecret();
  const userCode = generateUserCode();
  return db.transaction(async (tx) => {
    await lockRunnerLoginStarts(tx);
    await deleteLoginsExpiredBefore(tx, EXPIRED_LOGIN_RETENTION_MS);
    if ((await countPendingLogins(tx)) >= PENDING_LOGIN_LIMIT) return fail('TOO_MANY_REQUESTS');
    const expiresAt = await insertLogin(tx, {
      deviceSecretHash: hashSecret(deviceSecret),
      userCodeHash: hashUserCode(userCode),
      name: input.name,
      platform: input.platform,
      ttlMs: env.RUNNER_LOGIN_TTL_MS,
    });
    const approveUrl = new URL('/runners/approve', env.BETTER_AUTH_URL);
    approveUrl.searchParams.set('code', userCode);
    return ok({
      deviceSecret,
      userCode,
      approveUrl: approveUrl.href,
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  });
}

/** The login request a user code names. A completed one reads as approved. */
export async function getLogin(
  { db }: ServiceDeps,
  userCode: string,
): Promise<Result<RunnerLogin, 'NOT_FOUND'>> {
  const row = await findLiveLoginByUserCodeHash(db, hashUserCode(userCode));
  return row === undefined ? fail('NOT_FOUND') : ok(toRunnerLogin(row));
}

/** Moves a pending login request to the decision's status, under its row lock. */
async function decideLogin(
  { db }: ServiceDeps,
  userCode: string,
  decision: { status: 'approved'; userId: string } | { status: 'denied' },
): Promise<Result<RunnerLogin, 'NOT_FOUND' | 'CONFLICT'>> {
  return db.transaction(async (tx) => {
    const row = await lockLiveLoginByUserCodeHash(tx, hashUserCode(userCode));
    if (row === undefined) return fail('NOT_FOUND');
    if (row.status !== 'pending') return fail('CONFLICT');
    await setLoginDecision(tx, row.id, decision);
    return ok(toRunnerLogin(row, decision.status));
  });
}

export function approveLogin(deps: ServiceDeps, userId: string, userCode: string) {
  return decideLogin(deps, userCode, { status: 'approved', userId });
}

export function denyLogin(deps: ServiceDeps, userCode: string) {
  return decideLogin(deps, userCode, { status: 'denied' });
}

/**
 * Answers a runner's poll. An approved login request completes in the poll's transaction, which
 * is the only time the token leaves the API. Every other case, including an unknown device
 * secret and a completed or expired request, answers `expired`, which tells a guesser nothing.
 */
export async function pollLogin(
  { db }: ServiceDeps,
  deviceSecret: string,
): Promise<RunnerPollLoginOutput> {
  return db.transaction(async (tx): Promise<RunnerPollLoginOutput> => {
    const row = await lockLoginByDeviceSecretHash(tx, hashSecret(deviceSecret));
    if (row === undefined) return { status: 'expired' };
    // The approval itself came in time, so an approved request completes whatever its expiry.
    if (row.status === 'approved' && row.userId !== null) {
      const token = generateRunnerToken();
      const runnerId = await insertRunner(tx, {
        userId: row.userId,
        name: row.name,
        platform: row.platform,
        tokenHash: hashSecret(token),
      });
      await setLoginCompleted(tx, row.id, runnerId);
      return { status: 'approved', runnerId, token };
    }
    if (row.expired) return { status: 'expired' };
    if (row.status === 'pending') return { status: 'pending' };
    if (row.status === 'denied') return { status: 'denied' };
    return { status: 'expired' };
  });
}

import { z } from 'zod';
import { base } from './base.ts';
import { PageInput, pageOutput } from './pagination.ts';

export const RunnerStatus = z.enum(['active', 'revoked']);
export type RunnerStatus = z.infer<typeof RunnerStatus>;

export const RunnerPlatform = z.enum(['win32', 'darwin', 'linux']);
export type RunnerPlatform = z.infer<typeof RunnerPlatform>;

export const CLAUDE_CODE_MIN_VERSION = '2.1.284';

export const CliStatus = z.object({
  name: z.literal('claude-code'),
  version: z.string().max(50).nullable(),
  available: z.boolean(),
  minimumVersion: z.string().max(50),
});
export type CliStatus = z.infer<typeof CliStatus>;

export const Runner = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: RunnerPlatform,
  status: RunnerStatus,
  online: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  planLimitResetsAt: z.iso.datetime().nullable(),
  concurrencyLimit: z.int().nullable(),
  clis: z.array(CliStatus),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type Runner = z.infer<typeof Runner>;

export const RunnerLoginStatus = z.enum(['pending', 'approved', 'denied', 'completed']);
export type RunnerLoginStatus = z.infer<typeof RunnerLoginStatus>;

/** Twelve Crockford base32 characters, with or without the dashes between groups of four. */
export const RunnerUserCode = z
  .string()
  .regex(
    /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/,
    'must be a user code like ABCD-EFGH-JKMN',
  );

export const RunnerStartLoginInput = z.strictObject({
  name: z.string().min(1).max(100),
  platform: RunnerPlatform,
});

export const RunnerStartLoginOutput = z.object({
  deviceSecret: z.string(),
  userCode: z.string(),
  approveUrl: z.url({ protocol: /^https?$/ }),
  expiresAt: z.iso.datetime(),
  pollIntervalMs: z.int(),
});
export type RunnerStartLoginOutput = z.infer<typeof RunnerStartLoginOutput>;

/** The device secret is 32 random bytes as base64url. */
export const RunnerPollLoginInput = z.strictObject({
  deviceSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const RunnerPollLoginOutput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('approved'), runnerId: z.uuid(), token: z.string() }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
]);
export type RunnerPollLoginOutput = z.infer<typeof RunnerPollLoginOutput>;

export const RunnerUserCodeInput = z.strictObject({ userCode: RunnerUserCode });

/** A completed login request reads as approved, so the approval page keeps its state. */
export const RunnerLogin = z.object({
  name: z.string(),
  platform: RunnerPlatform,
  status: RunnerLoginStatus.exclude(['completed']),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type RunnerLogin = z.infer<typeof RunnerLogin>;

export const RunnerRevokeInput = z.strictObject({ runnerId: z.uuid() });

/** Public: the runner starts a login request before it has a token or a session. */
export const runnerStartLogin = base
  .errors({ TOO_MANY_REQUESTS: { status: 429 } })
  .input(RunnerStartLoginInput)
  .output(RunnerStartLoginOutput);

/** Public: the runner polls with its device secret, which only it holds. */
export const runnerPollLogin = base.input(RunnerPollLoginInput).output(RunnerPollLoginOutput);

export const runnerGetLogin = base
  .errors({ NOT_FOUND: { status: 404 } })
  .input(RunnerUserCodeInput)
  .output(RunnerLogin);

export const runnerApproveLogin = base
  .errors({ NOT_FOUND: { status: 404 }, CONFLICT: { status: 409 } })
  .input(RunnerUserCodeInput)
  .output(RunnerLogin);

export const runnerDenyLogin = base
  .errors({ NOT_FOUND: { status: 404 }, CONFLICT: { status: 409 } })
  .input(RunnerUserCodeInput)
  .output(RunnerLogin);

export const runnerList = base.input(PageInput).output(pageOutput(Runner));

export const runnerRevoke = base
  .errors({ NOT_FOUND: { status: 404 } })
  .input(RunnerRevokeInput)
  .output(Runner);

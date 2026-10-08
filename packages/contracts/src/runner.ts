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

export const RunnerCreatePairingCodeOutput = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Twelve Crockford base32 characters, with or without the dashes between groups of four. */
export const PAIRING_CODE_PATTERN = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

export const RunnerPairInput = z.strictObject({
  code: z.string().regex(PAIRING_CODE_PATTERN, 'must be a pairing code like ABCD-EFGH-JKMN'),
  name: z.string().min(1).max(100),
  platform: RunnerPlatform,
});

export const RunnerPairOutput = z.object({ runnerId: z.uuid(), token: z.string() });

export const RunnerRevokeInput = z.strictObject({ runnerId: z.uuid() });

export const runnerCreatePairingCode = base
  .errors({ TOO_MANY_REQUESTS: { status: 429 } })
  .output(RunnerCreatePairingCodeOutput);

/** Public: the runner calls it with a pairing code, before it has a token. */
export const runnerPair = base
  .errors({ PAIRING_CODE_REJECTED: { status: 401 } })
  .input(RunnerPairInput)
  .output(RunnerPairOutput);

export const runnerList = base.input(PageInput).output(pageOutput(Runner));

export const runnerRevoke = base
  .errors({ NOT_FOUND: { status: 404 } })
  .input(RunnerRevokeInput)
  .output(Runner);

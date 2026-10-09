import path from 'node:path';
import { SetupToken } from '@plangineer/contracts';
import { z } from 'zod';
import { PACKAGE_ROOT } from './package-root.ts';

function integer(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, 'must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

const port = integer(1, 65535);
const intervalMs = integer(1_000, 60_000);
const durationMs = integer(1, 86_400_000);

const EnvSchema = z
  .object({
    DATABASE_URL: z.url(),
    API_HOST: z.string().min(1),
    API_PORT: port,
    API_LOG_FILE: z
      .string()
      .min(1)
      .transform((value) => path.resolve(PACKAGE_ROOT, value)),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    SETUP_TOKEN: SetupToken,
    RUNNER_HEARTBEAT_INTERVAL_MS: intervalMs,
    RUN_LEASE_DURATION_MS: durationMs,
    RUNNER_OFFLINE_AFTER_MS: durationMs,
    RUN_SWEEP_INTERVAL_MS: intervalMs,
    RUN_MAX_ATTEMPTS: integer(1, 10),
    SSE_KEEPALIVE_INTERVAL_MS: intervalMs,
    RUNNER_LOGIN_TTL_MS: integer(60_000, 3_600_000),
    // Set where the API serves the built web app. Unset in dev, where Vite serves it.
    WEB_DIST_DIR: z
      .string()
      .refine((value) => path.isAbsolute(value), 'must be an absolute path')
      .optional(),
  })
  .superRefine((env, context) => {
    // A lease and the online window must each survive two missed heartbeats.
    for (const key of ['RUN_LEASE_DURATION_MS', 'RUNNER_OFFLINE_AFTER_MS'] as const) {
      if (env[key] < 3 * env.RUNNER_HEARTBEAT_INTERVAL_MS) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be at least 3 times RUNNER_HEARTBEAT_INTERVAL_MS',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses the API's environment, throwing one error that names every missing or invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new Error(`Invalid environment:\n${problems.join('\n')}`);
}

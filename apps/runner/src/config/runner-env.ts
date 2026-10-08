import path from 'node:path';
import envPaths from 'env-paths';
import { z } from 'zod';

const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const jsonCommand = z
  .string()
  .transform((text, context) => {
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a JSON array of strings' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().min(1), 'must be a JSON array of strings').min(1).max(10));

const gitBaseUrl = z
  .url()
  .refine(
    (url) => ['https:', 'file:'].includes(new URL(url).protocol),
    'must be an https: or file: URL',
  )
  .transform((url) => url.replace(/\/+$/, ''));

const RunnerEnvSchema = z.object({
  PLANGINEER_RUNNER_DATA_DIR: z
    .string()
    .refine((dir) => path.isAbsolute(dir), 'must be an absolute path')
    .default(() => envPaths('plangineer-runner', { suffix: '' }).data),
  PLANGINEER_RUNNER_CONCURRENCY: integer(1, 16).default(2),
  PLANGINEER_CLAUDE_COMMAND: jsonCommand.default(['claude']),
  PLANGINEER_GIT_BASE_URL: gitBaseUrl.default('https://github.com'),
  PLANGINEER_RUN_TIMEOUT_MS: integer(1_000, 86_400_000).default(3_600_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type RunnerEnv = z.infer<typeof RunnerEnvSchema>;

/**
 * Parses the runner's environment. Every variable is optional, and each absence has one meaning.
 * An invalid variable fails with a message naming each one.
 */
export function parseRunnerEnv(
  source: Record<string, string | undefined>,
): { ok: true; env: RunnerEnv } | { ok: false; message: string } {
  const result = RunnerEnvSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  const problems = result.error.issues.map(
    (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
  );
  return { ok: false, message: `Invalid environment:\n${problems.join('\n')}` };
}

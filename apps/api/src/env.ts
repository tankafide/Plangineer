import { z } from 'zod';

const port = z
  .string()
  .regex(/^\d+$/, 'must be an integer')
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  API_PORT: port,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
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

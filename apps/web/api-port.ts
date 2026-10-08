import { z } from 'zod';

const ApiPortEnv = z.object({
  API_PORT: z
    .string()
    .regex(/^\d+$/, 'must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535)),
});

/** The API's port from the root .env, which the dev proxy and Playwright both need. */
export function readApiPort(env: Record<string, string | undefined>): number {
  return ApiPortEnv.parse(env).API_PORT;
}

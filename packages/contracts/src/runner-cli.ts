import { z } from 'zod';

export const RUNNER_LOGIN_MESSAGE_MAX = 500;

/** One line `plangineer-runner login --json` prints on stdout. */
export const RunnerLoginEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('login_started'),
    userCode: z.string(),
    approveUrl: z.url(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({ event: z.literal('paired'), runnerId: z.uuid() }),
  z.object({ event: z.literal('failed'), message: z.string().max(RUNNER_LOGIN_MESSAGE_MAX) }),
]);
export type RunnerLoginEvent = z.infer<typeof RunnerLoginEvent>;

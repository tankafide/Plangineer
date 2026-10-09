import { z } from 'zod';

export const GITHUB_FAILED_MESSAGE_MAX = 500;

/** The error a procedure answers when a GitHub call fails, with GitHub's status and message. */
export const GithubFailed = {
  status: 502,
  data: z.object({ status: z.int(), message: z.string().max(GITHUB_FAILED_MESSAGE_MAX) }),
};

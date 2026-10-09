import { z } from 'zod';
import { base } from './base.ts';
import { GithubFailed } from './github-failed.ts';

export const GithubAppState = z.enum(['missing', 'configured']);
export type GithubAppState = z.infer<typeof GithubAppState>;

export const InstanceStatus = z.object({
  githubApp: GithubAppState,
  githubAppSlug: z.string().nullable(),
});
export type InstanceStatus = z.infer<typeof InstanceStatus>;

/** The token that guards GitHub App creation, spent once an App exists. */
export const SetupToken = z.string().min(32).max(200);

export const InstanceGithubAppManifestInput = z.strictObject({ setupToken: SetupToken });
export type InstanceGithubAppManifestInput = z.infer<typeof InstanceGithubAppManifestInput>;

export const InstanceGithubAppManifestOutput = z.object({
  postUrl: z.url(),
  manifest: z.string().max(10_000),
});
export type InstanceGithubAppManifestOutput = z.infer<typeof InstanceGithubAppManifestOutput>;

export const InstanceCompleteGithubAppInput = z.strictObject({
  setupToken: SetupToken,
  code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
});
export type InstanceCompleteGithubAppInput = z.infer<typeof InstanceCompleteGithubAppInput>;

const Conflict = { status: 409 };

/** Public: the setup screen and the sign-in card read it before anyone can sign in. */
export const instanceGetStatus = base.output(InstanceStatus);

export const instanceGithubAppManifest = base
  .errors({ CONFLICT: Conflict })
  .input(InstanceGithubAppManifestInput)
  .output(InstanceGithubAppManifestOutput);

export const instanceCompleteGithubApp = base
  .errors({ CONFLICT: Conflict, GITHUB_FAILED: GithubFailed })
  .input(InstanceCompleteGithubAppInput)
  .output(InstanceStatus);

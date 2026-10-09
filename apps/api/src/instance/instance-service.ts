import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  InstanceCompleteGithubAppInput,
  InstanceGithubAppManifestOutput,
  InstanceStatus,
} from '@plangineer/contracts';
import { convertManifestCode } from '../github/github-app-conversion.ts';
import { buildManifest, MANIFEST_POST_URL } from '../github/github-app-manifest.ts';
import type { GithubAppCredentials } from '../github/github-app-store.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { githubFailed } from '../repositories/repository-service.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Compares hashes of equal length, so the comparison takes the same time for any input. */
function isSetupToken({ env }: ServiceDeps, setupToken: string): boolean {
  return timingSafeEqual(sha256(setupToken), sha256(env.SETUP_TOKEN));
}

function toStatus(app: GithubAppCredentials | null): InstanceStatus {
  return app === null
    ? { githubApp: 'missing', githubAppSlug: null }
    : { githubApp: 'configured', githubAppSlug: app.slug };
}

export async function getInstanceStatus({ appStore }: ServiceDeps): Promise<InstanceStatus> {
  return toStatus(await appStore.get());
}

/**
 * The manifest that creates this deployment's GitHub App. The setup token guards it, and it is
 * spent once an App exists.
 */
export async function createGithubAppManifest(
  deps: ServiceDeps,
  setupToken: string,
): Promise<Result<InstanceGithubAppManifestOutput, 'UNAUTHORIZED' | 'CONFLICT'>> {
  if (!isSetupToken(deps, setupToken)) return fail('UNAUTHORIZED');
  if ((await deps.appStore.get()) !== null) return fail('CONFLICT');
  return ok({
    postUrl: MANIFEST_POST_URL,
    manifest: JSON.stringify(buildManifest(deps.env.BETTER_AUTH_URL)),
  });
}

/** Converts the manifest flow's code into the App and stores it, once. */
export async function completeGithubApp(
  deps: ServiceDeps,
  { setupToken, code }: InstanceCompleteGithubAppInput,
): Promise<Result<InstanceStatus, 'UNAUTHORIZED' | 'CONFLICT' | 'GITHUB_FAILED'>> {
  if (!isSetupToken(deps, setupToken)) return fail('UNAUTHORIZED');
  if ((await deps.appStore.get()) !== null) return fail('CONFLICT');
  let app: GithubAppCredentials;
  try {
    app = await convertManifestCode(code);
  } catch (error) {
    return githubFailed(error);
  }
  if ((await deps.appStore.save(app)) === 'exists') return fail('CONFLICT');
  deps.logger.info({ slug: app.slug }, 'GitHub App created');
  return ok(toStatus(app));
}

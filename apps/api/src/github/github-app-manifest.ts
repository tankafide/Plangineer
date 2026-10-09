import { randomBytes } from 'node:crypto';

/** GitHub's page that creates an App from a manifest, on the signed-in GitHub account. */
export const MANIFEST_POST_URL = 'https://github.com/settings/apps/new';

/**
 * The GitHub App's manifest for GitHub's manifest flow, with every URL on `origin`. Contents are
 * read-only, since the runner pushes with the engineer's own credentials. Webhooks stay off,
 * since nothing uses them yet. After an install, GitHub sends the admin to the Repositories
 * screen.
 */
export function buildManifest(origin: string) {
  return {
    name: `plangineer-${randomBytes(3).toString('hex')}`,
    url: 'https://github.com/tankafide/Plangineer',
    redirect_url: `${origin}/get-started`,
    callback_urls: [`${origin}/api/auth/callback/github`],
    setup_url: `${origin}/repositories`,
    setup_on_update: true,
    public: false,
    hook_attributes: { url: 'https://example.com/plangineer-webhook', active: false },
    default_permissions: {
      contents: 'read',
      pull_requests: 'write',
      checks: 'read',
      metadata: 'read',
      emails: 'read',
    },
    default_events: [],
  };
}

import { randomBytes } from 'node:crypto';

const WEB_ORIGIN = 'http://localhost:5173';

/**
 * The dev GitHub App's manifest, for GitHub's manifest flow. Contents are read-only, since the
 * runner pushes with the engineer's own credentials. After an install, GitHub sends the admin
 * back to the Repositories screen.
 */
export function buildManifest(redirectUrl) {
  return {
    name: `plangineer-dev-${randomBytes(3).toString('hex')}`,
    url: 'https://github.com/tankafide/Plangineer',
    redirect_url: redirectUrl,
    callback_urls: [`${WEB_ORIGIN}/api/auth/callback/github`],
    setup_url: `${WEB_ORIGIN}/repositories`,
    setup_on_update: true,
    public: false,
    hook_attributes: { url: 'https://example.com/plangineer-dev-webhook', active: false },
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

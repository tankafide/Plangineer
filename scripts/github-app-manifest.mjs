import { randomBytes } from 'node:crypto';

/** The dev GitHub App's manifest, for GitHub's manifest flow. */
export function buildManifest(redirectUrl) {
  return {
    name: `plangineer-dev-${randomBytes(3).toString('hex')}`,
    url: 'https://github.com/tankafide/Plangineer',
    redirect_url: redirectUrl,
    callback_urls: ['http://localhost:5173/api/auth/callback/github'],
    public: false,
    hook_attributes: { url: 'https://example.com/plangineer-dev-webhook', active: false },
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      checks: 'read',
      metadata: 'read',
      emails: 'read',
    },
    default_events: [],
  };
}

import { describe, expect, it } from 'vitest';
import { buildManifest } from './github-app-manifest.mjs';

const REDIRECT = 'http://127.0.0.1:49152/callback';

describe('buildManifest', () => {
  it('returns the dev app fields with the given redirect URL', () => {
    expect(buildManifest(REDIRECT)).toEqual({
      name: expect.stringMatching(/^plangineer-dev-[0-9a-f]{6}$/),
      url: 'https://github.com/tankafide/Plangineer',
      redirect_url: REDIRECT,
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
    });
  });

  it('gives each app a new name, since names are unique across GitHub', () => {
    expect(buildManifest(REDIRECT).name).not.toBe(buildManifest(REDIRECT).name);
  });
});

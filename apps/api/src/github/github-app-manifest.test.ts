import { describe, expect, it } from 'vitest';
import { buildManifest } from './github-app-manifest.ts';

describe('buildManifest', () => {
  const manifest = buildManifest('http://127.0.0.1:47100');

  it('names the App plangineer and six hex characters', () => {
    expect(manifest.name).toMatch(/^plangineer-[0-9a-f]{6}$/);
  });

  it('puts every URL on the origin', () => {
    expect(manifest).toMatchObject({
      redirect_url: 'http://127.0.0.1:47100/get-started',
      callback_urls: ['http://127.0.0.1:47100/api/auth/callback/github'],
      setup_url: 'http://127.0.0.1:47100/repositories',
    });
  });

  it('keeps webhooks off and contents read-only', () => {
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest.default_permissions).toMatchObject({ contents: 'read', emails: 'read' });
    expect(manifest.default_events).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readConversion } from './github-app-conversion.mjs';

function app(overrides = {}) {
  return {
    id: 123,
    slug: 'plangineer-dev-abc123',
    client_id: 'Iv1.abc',
    client_secret: 'secret',
    pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n',
    html_url: 'https://github.com/apps/plangineer-dev-abc123',
    ...overrides,
  };
}

describe('readConversion', () => {
  it('returns the app fields .env needs', async () => {
    const converted = await readConversion(Response.json(app()));

    expect(converted).toEqual({
      id: 123,
      client_id: 'Iv1.abc',
      client_secret: 'secret',
      pem: app().pem,
      html_url: 'https://github.com/apps/plangineer-dev-abc123',
    });
  });

  it('reports the status and body of a failed conversion that is not JSON', async () => {
    const response = new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' });

    await expect(readConversion(response)).rejects.toThrow(
      'GitHub answered 502 Bad Gateway: Bad gateway',
    );
  });

  it('names missing and invalid fields without their values', async () => {
    const response = Response.json(app({ client_secret: undefined, pem: 'not a key' }));

    await expect(readConversion(response)).rejects.toThrow(
      "GitHub's conversion response is missing or has invalid fields: client_secret, pem",
    );
  });
});

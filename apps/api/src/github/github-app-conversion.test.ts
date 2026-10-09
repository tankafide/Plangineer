import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { GITHUB_FAILED_MESSAGE_MAX } from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { convertManifestCode } from './github-app-conversion.ts';
import { GithubError } from './github.ts';

const PKCS1_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const CONVERSION = {
  id: 777,
  slug: 'plangineer-a1b2c3',
  clientId: 'Iv23client',
  clientSecret: 'client-secret',
  pem: PKCS1_KEY,
  ownerLogin: 'ada',
};

describe('convertManifestCode', () => {
  let fake: FakeGithub;

  beforeAll(() => {
    fake = startFakeGithub();
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(() => {
    fake.close();
  });

  it('returns the App with its PKCS#1 key as the same key in PKCS#8', async () => {
    fake.manifestConversions.set('code-1', CONVERSION);

    const app = await convertManifestCode('code-1');

    expect(app).toEqual({
      appId: 777,
      slug: 'plangineer-a1b2c3',
      clientId: 'Iv23client',
      clientSecret: 'client-secret',
      privateKey: expect.stringMatching(/^-----BEGIN PRIVATE KEY-----\n/),
      ownerLogin: 'ada',
    });
    expect(createPrivateKey(app.privateKey).export({ type: 'pkcs1', format: 'pem' })).toBe(
      PKCS1_KEY,
    );
  });

  it('raises a GithubError with GitHub status for an unknown code', async () => {
    const error = await convertManifestCode('unknown').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GithubError);
    expect(error).toMatchObject({ status: 404, message: expect.stringContaining('Not Found') });
  });

  it('cuts a long GitHub message to the contract limit', async () => {
    fake.fail(/app-manifests/, 422, 'x'.repeat(2_000));

    const error = await convertManifestCode('code-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GithubError);
    expect(error).toHaveProperty('message.length', GITHUB_FAILED_MESSAGE_MAX);
  });

  it('raises a GithubError naming the field for a body with a bad key, without the key', async () => {
    fake.manifestConversions.set('code-1', { ...CONVERSION, pem: 'secret-but-not-a-pem' });

    const error = await convertManifestCode('code-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GithubError);
    expect(String(error)).toContain('pem');
    expect(String(error)).not.toContain('secret-but-not-a-pem');
  });
});

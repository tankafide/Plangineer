import type { GithubAppCredentials } from '../github/github-app-store.ts';

/** The secret every test environment uses, which encrypts the test App in the template. */
export const TEST_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters';

export const GITHUB_CLIENT_ID = 'test-github-client-id';

/** The GitHub App the API test global setup stores in the template database. */
export function testGithubApp(privateKey: string): GithubAppCredentials {
  return {
    appId: 4242,
    slug: 'plangineer-test',
    clientId: GITHUB_CLIENT_ID,
    clientSecret: 'test-github-client-secret',
    privateKey,
    ownerLogin: 'plangineer-test-owner',
  };
}

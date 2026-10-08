import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setEnvValues } from './env-file.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

/**
 * Placeholder GitHub App values, so the API starts before pnpm setup:github-app writes the real
 * App. Every GitHub call fails until then. The key is throwaway, in GitHub's PKCS#1 form.
 */
function placeholderGithubApp() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'plangineer-dev',
    GITHUB_APP_PRIVATE_KEY: privateKey,
  };
}

/** Creates .env from .env.example with a fresh BETTER_AUTH_SECRET, and refuses to overwrite one. */
export async function setupEnv(rootDir) {
  const example = await readFile(path.join(rootDir, '.env.example'), 'utf8');
  const text = setEnvValues(example, {
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    ...placeholderGithubApp(),
  });
  try {
    await writeFile(path.join(rootDir, '.env'), text, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error('.env already exists. Delete it to start over.');
    return 1;
  }
  console.log('Created .env with a new BETTER_AUTH_SECRET and placeholder GitHub App values.');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await setupEnv(repoRoot);
}

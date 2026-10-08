import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setEnvValues } from './env-file.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

/** Creates .env from .env.example with a fresh BETTER_AUTH_SECRET, and refuses to overwrite one. */
export async function setupEnv(rootDir) {
  const example = await readFile(path.join(rootDir, '.env.example'), 'utf8');
  const text = setEnvValues(example, { BETTER_AUTH_SECRET: randomBytes(32).toString('base64url') });
  try {
    await writeFile(path.join(rootDir, '.env'), text, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error('.env already exists. Delete it to start over.');
    return 1;
  }
  console.log('Created .env with a new BETTER_AUTH_SECRET.');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await setupEnv(repoRoot);
}

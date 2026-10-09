import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { setEnvValues } from './env-file.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

/** The secrets each new .env gets in place of the example's placeholders. */
function generatedValues() {
  return {
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    SETUP_TOKEN: randomBytes(32).toString('base64url'),
  };
}

/** The values pnpm setup:env writes: the example's, with a fresh secret and setup token. */
export function envValues(exampleText) {
  return { ...parseEnv(exampleText), ...generatedValues() };
}

/** Creates .env from .env.example with fresh secrets, and refuses to overwrite one. */
export async function setupEnv(rootDir) {
  const example = await readFile(path.join(rootDir, '.env.example'), 'utf8');
  const text = setEnvValues(example, generatedValues());
  try {
    await writeFile(path.join(rootDir, '.env'), text, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error('.env already exists. Delete it to start over.');
    return 1;
  }
  console.log('Created .env with a new BETTER_AUTH_SECRET and SETUP_TOKEN.');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await setupEnv(repoRoot);
}

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

export type ServerEnv = Readonly<Record<string, string>>;

export interface ServerEnvOptions {
  /** The shipped copy of `.env.example`. */
  examplePath: string;
  serverEnvPath: string;
  apiPort: number;
  postgresPort: number;
}

/** Passed at launch because it points into the logs folder, so it is never stored. */
const LAUNCH_ONLY_KEY = 'API_LOG_FILE';

/** The values of a dotenv text, read with Node's own parser. */
function parseServerEnv(text: string): ServerEnv {
  return Object.fromEntries(
    Object.entries(parseEnv(text)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function secret(): string {
  return randomBytes(32).toString('base64url');
}

function firstStartValues(apiPort: number, postgresPort: number): ServerEnv {
  const origin = `http://127.0.0.1:${apiPort}`;
  return {
    DATABASE_URL: `postgres://plangineer:${secret()}@127.0.0.1:${postgresPort}/plangineer`,
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret(),
    SETUP_TOKEN: secret(),
  };
}

/** One `KEY=value` line, refusing a value the env parser would not read back unchanged. */
function envLine(key: string, value: string): string {
  const line = `${key}=${value}\n`;
  if (parseServerEnv(line)[key] !== value) {
    throw new Error(`The value of ${key} cannot be written to server.env unquoted`);
  }
  return line;
}

function storedEntries(values: ServerEnv): [string, string][] {
  return Object.entries(values).filter(([key]) => key !== LAUNCH_ONLY_KEY);
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Writes through a temp file and a rename, so a crash never leaves half a file. */
async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
}

/**
 * Returns the server environment, writing `server.env` on first start from the shipped example
 * with fresh secrets and the desktop's ports. Later starts keep the file as the source of truth
 * and only append keys a newer example added, with their example values.
 */
export async function ensureServerEnv(options: ServerEnvOptions): Promise<ServerEnv> {
  const example = parseServerEnv(await readFile(options.examplePath, 'utf8'));
  const existing = await readOptional(options.serverEnvPath);

  if (existing === undefined) {
    const values = { ...example, ...firstStartValues(options.apiPort, options.postgresPort) };
    const text = storedEntries(values)
      .map(([key, value]) => envLine(key, value))
      .join('');
    await writeAtomically(options.serverEnvPath, text);
    return parseServerEnv(text);
  }

  const current = parseServerEnv(existing);
  const missing = storedEntries(example).filter(([key]) => !(key in current));
  if (missing.length === 0) return current;
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  const text = existing + separator + missing.map(([key, value]) => envLine(key, value)).join('');
  await writeAtomically(options.serverEnvPath, text);
  return parseServerEnv(text);
}

/** A value the desktop needs from `server.env`, failing loudly when it was removed. */
export function requireValue(env: ServerEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') throw new Error(`server.env has no ${key}`);
  return value;
}

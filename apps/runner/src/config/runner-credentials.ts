import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const RunnerCredentials = z.strictObject({
  serverUrl: z.url({ protocol: /^https?$/ }),
  runnerId: z.uuid(),
  token: z.string().min(1),
});
export type RunnerCredentials = z.infer<typeof RunnerCredentials>;

/** Writes `runner.json` readable by the owner only, through a temporary file and a rename. */
export async function writeCredentials(
  file: string,
  credentials: RunnerCredentials,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

/** Reads `runner.json`, or returns null when the runner has not been paired. */
export async function readCredentials(file: string): Promise<RunnerCredentials | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return RunnerCredentials.parse(JSON.parse(text));
}

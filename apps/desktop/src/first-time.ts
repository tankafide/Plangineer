import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Returns true the first time it is called with a marker file and false ever after, for
 * something the desktop does once per install, such as turning on Open at login.
 */
export async function firstTime(markerFile: string): Promise<boolean> {
  await mkdir(path.dirname(markerFile), { recursive: true });
  try {
    await writeFile(markerFile, '', { flag: 'wx' });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

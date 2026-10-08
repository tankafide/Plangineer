import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { z } from 'zod';
import { SESSION_STATE } from './session-state.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WEB_ORIGIN = 'localhost';

const SessionCookie = z.object({ name: z.string().min(1), value: z.string().min(1) });

/** Signs in one e2e user through the API's session CLI and saves it as Playwright storage state. */
export default async function globalSetup(): Promise<void> {
  const { stdout } = await execa(
    'pnpm',
    ['--silent', '--filter', '@plangineer/api', 'e2e:session'],
    { cwd: REPO_ROOT },
  );
  const cookie = SessionCookie.parse(JSON.parse(stdout));
  await mkdir(path.dirname(SESSION_STATE), { recursive: true });
  await writeFile(
    SESSION_STATE,
    JSON.stringify({
      cookies: [
        {
          ...cookie,
          domain: WEB_ORIGIN,
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}

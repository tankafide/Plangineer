import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { z } from 'zod';
import { E2E_APP_STATE, SESSION_STATE } from './session-state.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WEB_ORIGIN = 'localhost';

const SessionCookie = z.object({ name: z.string().min(1), value: z.string().min(1) });

const GithubApp = z.object({ clientId: z.string().min(1) });

/**
 * Saves the stored GitHub App's client ID, which pnpm test:e2e stored before the API started,
 * and signs in one e2e user through the API's session CLI as Playwright storage state.
 */
export default async function globalSetup(): Promise<void> {
  const app = await execa('pnpm', ['--silent', '--filter', '@plangineer/api', 'e2e:github-app'], {
    cwd: REPO_ROOT,
  });
  const { stdout } = await execa(
    'pnpm',
    ['--silent', '--filter', '@plangineer/api', 'e2e:session'],
    { cwd: REPO_ROOT },
  );
  const cookie = SessionCookie.parse(JSON.parse(stdout));
  await mkdir(path.dirname(SESSION_STATE), { recursive: true });
  await writeFile(E2E_APP_STATE, JSON.stringify(GithubApp.parse(JSON.parse(app.stdout))));
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

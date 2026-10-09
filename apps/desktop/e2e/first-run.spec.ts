import { readdirSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { _electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { execa } from 'execa';
import { createDesktopClient } from '../src/api-client.ts';

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = path.join(DESKTOP_DIR, '..', '..');
const RELEASE_DIR = path.join(DESKTOP_DIR, 'release');
const ORIGIN = 'http://127.0.0.1:47100';
const PG_CTL = path.join(RELEASE_DIR, 'linux-unpacked', 'resources', 'postgres', 'bin', 'pg_ctl');

/** The AppImage `pnpm desktop:build` wrote, the artifact people download. */
function appImage(): string {
  const file = readdirSync(RELEASE_DIR).find((name) => name.endsWith('.AppImage'));
  if (file === undefined)
    throw new Error('No AppImage in apps/desktop/release. Run pnpm desktop:build.');
  return path.join(RELEASE_DIR, file);
}

/** Empty XDG folders, so the app starts as on a new machine. */
interface Folders {
  root: string;
  config: string;
  data: string;
  state: string;
}

async function emptyFolders(): Promise<Folders> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-first-run-'));
  return {
    root,
    config: path.join(root, 'config'),
    data: path.join(root, 'data'),
    state: path.join(root, 'state'),
  };
}

function launch(folders: Folders, args: string[] = []): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: appImage(),
    args,
    env: {
      ...process.env,
      // The CI runner has no FUSE, so the AppImage extracts itself and runs.
      APPIMAGE_EXTRACT_AND_RUN: '1',
      XDG_CONFIG_HOME: folders.config,
      XDG_DATA_HOME: folders.data,
      XDG_STATE_HOME: folders.state,
    },
  });
}

async function apiAnswersOk(): Promise<number> {
  const response = await fetch(`${ORIGIN}/api/auth/ok`).catch(() => undefined);
  return response?.status ?? 0;
}

async function windowAt(app: ElectronApplication, pathname: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      () => {
        found = app.windows().find((page) => new URL(page.url()).pathname === pathname);
        return found !== undefined;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  if (found === undefined) throw new Error(`No window at ${pathname}`);
  return found;
}

async function postgresRunning(folders: Folders): Promise<boolean> {
  const dataDir = path.join(folders.data, 'Plangineer', 'postgres');
  const status = await execa(PG_CTL, ['status', '-D', dataDir], { reject: false, stdin: 'ignore' });
  return status.exitCode === 0;
}

/** The app's server.env plus a log file, for the API's e2e CLIs. */
async function serverEnv(folders: Folders): Promise<Record<string, string | undefined>> {
  const text = await readFile(path.join(folders.config, 'Plangineer', 'server.env'), 'utf8');
  return { ...parseEnv(text), API_LOG_FILE: path.join(folders.root, 'cli-api.log') };
}

async function runApiCli(
  script: string,
  env: Record<string, string | undefined>,
): Promise<unknown> {
  const result = await execa(process.execPath, [path.join('apps', 'api', 'src', 'test', script)], {
    cwd: REPO_ROOT,
    env,
  });
  return JSON.parse(result.stdout);
}

function cookieFrom(value: unknown): { name: string; value: string } {
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'value' in value &&
    typeof value.name === 'string' &&
    typeof value.value === 'string'
  ) {
    return { name: value.name, value: value.value };
  }
  throw new Error('The session CLI printed no cookie');
}

test.describe('the packaged Linux app', () => {
  let folders: Folders;
  let app: ElectronApplication | undefined;

  test.beforeEach(async () => {
    folders = await emptyFolders();
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    await rm(folders.root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('opens Get started on a first run and leaves no Postgres after quitting', async () => {
    app = await launch(folders);

    const page = await windowAt(app, '/get-started');
    await expect(page.getByRole('button', { name: 'Create GitHub App' })).toBeEnabled();

    await app.close();
    app = undefined;
    await access(path.join(folders.config, 'Plangineer', 'server.env'));
    expect(await postgresRunning(folders)).toBe(false);
  });

  test('starts the stack with no window when opened with --hidden', async () => {
    app = await launch(folders, ['--hidden']);

    await expect.poll(apiAnswersOk, { timeout: 120_000 }).toBe(200);
    const visible = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
    );
    expect(visible).toBe(0);
  });

  test('pairs its runner once a session cookie is set in the window partition', async () => {
    app = await launch(folders);
    await expect.poll(apiAnswersOk, { timeout: 120_000 }).toBe(200);

    const env = await serverEnv(folders);
    await runApiCli('e2e-github-app-cli.ts', env);
    const cookie = cookieFrom(await runApiCli('e2e-session-cli.ts', env));
    await app.evaluate(
      async ({ session }, { origin, name, value }) => {
        await session
          .fromPartition('persist:plangineer')
          .cookies.set({ url: origin, name, value, httpOnly: true });
      },
      { origin: ORIGIN, ...cookie },
    );

    const client = createDesktopClient(ORIGIN, (input, init) => {
      const request = new Request(input, init);
      request.headers.set('cookie', `${cookie.name}=${cookie.value}`);
      return fetch(request);
    });
    await expect
      .poll(
        async () => {
          const { items } = await client.runner.list({});
          return items.some((runner) => runner.name === os.hostname() && runner.online);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
  });
});

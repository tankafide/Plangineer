import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { fetchPostgres, POSTGRES_STAGE_DIR, postgresArchive } from './fetch-postgres.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

/** Each stage path and the repository path it is copied from. Postgres is fetched separately. */
const STAGE_LAYOUT = [
  ['server/dist', 'apps/api/dist'],
  ['server/drizzle', 'apps/api/drizzle'],
  ['server/src/setup/templates', 'apps/api/src/setup/templates'],
  ['server/src/features/templates', 'apps/api/src/features/templates'],
  ['server/src/planning/templates', 'apps/api/src/planning/templates'],
  ['server/env.example', '.env.example'],
  ['web', 'apps/web/dist'],
  ['runner/dist', 'apps/runner/dist'],
  ['runner/package.json', 'apps/runner/package.json'],
];

const toNative = (posixPath) => path.join(...posixPath.split('/'));

/**
 * Fills stageDir with the built bundles and assets the desktop app ships as extraResources,
 * leaving `postgres/` in place. Fails naming the first missing source path.
 */
export async function stageDesktop(rootDir, stageDir) {
  for (const [, source] of STAGE_LAYOUT) {
    try {
      await access(path.join(rootDir, toNative(source)));
    } catch {
      throw new Error(`${source} is missing. Run pnpm build first.`);
    }
  }
  for (const [target, source] of STAGE_LAYOUT) {
    const destination = path.join(stageDir, toNative(target));
    await rm(destination, { recursive: true, force: true, maxRetries: 5 });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(rootDir, toNative(source)), destination, { recursive: true });
  }
}

/** Runs a package's JavaScript CLI with this Node, failing on a nonzero exit. */
function runCli(packageName, args, cwd) {
  return execa(process.execPath, [binPath(packageName), ...args], { cwd, stdio: 'inherit' });
}

/**
 * Builds every package, including apps/desktop, fetches Postgres for this system, fills
 * apps/desktop/stage/ and packages the installer with electron-builder.
 */
async function buildDesktop(publish) {
  const desktopDir = path.join(repoRoot, 'apps', 'desktop');
  await runCli('turbo', ['run', 'build'], repoRoot);
  await fetchPostgres(postgresArchive(process.platform, process.arch), POSTGRES_STAGE_DIR);
  await stageDesktop(repoRoot, path.join(desktopDir, 'stage'));
  await runCli('electron-builder', ['--publish', publish], desktopDir);
}

if (isEntryPoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { publish: { type: 'string', default: 'never' } } });
    if (values.publish !== 'never' && values.publish !== 'always') {
      throw new Error('--publish must be never or always');
    }
    await buildDesktop(values.publish);
  } catch (error) {
    reportFailure(error);
  }
}

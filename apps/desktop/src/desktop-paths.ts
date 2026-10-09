import path from 'node:path';
import envPaths from 'env-paths';

/** The person's folders the desktop app writes to. Stack tests pass temp folders instead. */
export interface DesktopFolders {
  config: string;
  data: string;
  log: string;
}

export interface DesktopPaths {
  folders: DesktopFolders;
  serverEnv: string;
  postgresData: string;
  runnerData: string;
  apiLog: string;
  postgresLog: string;
  desktopLog: string;
  envExample: string;
  migrateBundle: string;
  apiBundle: string;
  runnerBundle: string;
  webDist: string;
  postgresBin: string;
}

/** The app's folders under env-paths, with no suffix, so they are named `Plangineer`. */
export function userFolders(): DesktopFolders {
  const { config, data, log } = envPaths('Plangineer', { suffix: '' });
  return { config, data, log };
}

/**
 * Every file the desktop app reads or writes. `resources` is `process.resourcesPath` when
 * packaged and `apps/desktop/stage/` from the checkout.
 */
export function desktopPaths(folders: DesktopFolders, resources: string): DesktopPaths {
  const server = path.join(resources, 'server');
  return {
    folders,
    serverEnv: path.join(folders.config, 'server.env'),
    postgresData: path.join(folders.data, 'postgres'),
    runnerData: path.join(folders.data, 'runner'),
    apiLog: path.join(folders.log, 'api.log'),
    postgresLog: path.join(folders.log, 'postgres.log'),
    desktopLog: path.join(folders.log, 'desktop.log'),
    envExample: path.join(server, 'env.example'),
    migrateBundle: path.join(server, 'dist', 'migrate.mjs'),
    apiBundle: path.join(server, 'dist', 'main.mjs'),
    runnerBundle: path.join(resources, 'runner', 'dist', 'cli.mjs'),
    webDist: path.join(resources, 'web'),
    postgresBin: path.join(resources, 'postgres', 'bin'),
  };
}

import type { DesktopLog } from './desktop-log.ts';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/tankafide/Plangineer/releases/tag';

/** What the tray offers once an update is found. */
export type UpdateOffer =
  | { kind: 'restart'; version: string }
  | { kind: 'download'; version: string; url: string };

/** The part of electron-updater's `autoUpdater` the desktop uses. */
export interface Updater {
  autoDownload: boolean;
  logger: {
    info(message?: unknown): void;
    warn(message?: unknown): void;
    error(message?: unknown): void;
  } | null;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  checkForUpdates(): Promise<unknown>;
}

export interface UpdatesOptions {
  platform: NodeJS.Platform;
  updater: Updater;
  log: DesktopLog;
  onOffer(offer: UpdateOffer): void;
}

/**
 * Checks GitHub Releases at start and every 6 hours. Windows and Linux download in the
 * background and offer a restart, installing on quit. An unsigned macOS app cannot replace
 * itself, so macOS downloads nothing and offers the release page.
 */
export function startUpdates(options: UpdatesOptions): void {
  const { updater, log } = options;
  updater.logger = log;
  const inPlace = options.platform !== 'darwin';
  updater.autoDownload = inPlace;
  if (inPlace) {
    updater.on('update-downloaded', ({ version }) => options.onOffer({ kind: 'restart', version }));
  } else {
    updater.on('update-available', ({ version }) =>
      options.onOffer({ kind: 'download', version, url: `${RELEASES_URL}/v${version}` }),
    );
  }

  function check(): void {
    updater.checkForUpdates().catch((error: unknown) => log.warn(error));
  }
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}

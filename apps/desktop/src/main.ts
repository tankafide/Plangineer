import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
  Tray,
  utilityProcess,
  type MessageBoxOptions,
} from 'electron';
import electronUpdater from 'electron-updater';
import { shellEnv } from 'shell-env';
import { createDesktopClient, type SessionFetch } from './api-client.ts';
import { createAppWindow, createStartupWindow, PARTITION, prepareSession } from './app-window.ts';
import { createDesktopLog } from './desktop-log.ts';
import { desktopPaths, userFolders } from './desktop-paths.ts';
import { firstTime } from './first-time.ts';
import { createLoginItem, HIDDEN_ARG, refreshLoginItem } from './login-item.ts';
import type { ForkNode } from './node-process.ts';
import { createQuitController } from './quit.ts';
import { startRunnerPairing, type RunnerPairing } from './runner-pairing.ts';
import { requireValue } from './server-env.ts';
import { type LocalStack, StackStartError, startStack } from './stack.ts';
import { realStopSystem } from './stop-process-tree.ts';
import { trayMenu, type TrayState } from './tray.ts';
import { type UpdateOffer, startUpdates } from './updates.ts';
import { runnerPathOverride } from './user-path.ts';

/** Fixed, because the GitHub App's callback URL holds the API's port (D17). */
const API_PORT = 47100;
const POSTGRES_PORT = 47101;

const { autoUpdater } = electronUpdater;
const hidden = process.argv.includes(HIDDEN_ARG);
const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'stage');
const paths = desktopPaths(userFolders(), resources);
const log = createDesktopLog(paths.desktopLog);

const forkNode: ForkNode = (modulePath, args, { env, serviceName }) =>
  utilityProcess.fork(modulePath, args, { env, serviceName, stdio: 'pipe' });

let stack: LocalStack | undefined;
let pairing: RunnerPairing | undefined;
let appWindow: BrowserWindow | undefined;
let startupWindow: BrowserWindow | undefined;
let appUrl: string | undefined;
let tray: Tray | undefined;
const trayState: TrayState = { packaged: app.isPackaged, openAtLogin: false, update: undefined };

async function stopStack(): Promise<void> {
  await pairing?.stop();
  pairing = undefined;
  await stack?.stop();
  stack = undefined;
}

const quit = createQuitController({ quit: () => app.quit(), stopStack, log });

const loginItem = createLoginItem({
  platform: process.platform,
  setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
  getLoginItemSettings: (options) => app.getLoginItemSettings(options),
  executablePath: app.getPath('exe'),
  appImagePath: process.env['APPIMAGE'],
  homeDir: app.getPath('home'),
  appDataDir: app.getPath('appData'),
});

async function openLogs(): Promise<void> {
  const failure = await shell.openPath(paths.folders.log);
  if (failure !== '') log.warn(`The logs folder did not open: ${failure}`);
}

/**
 * Shows an error dialog whose first button is Retry and second Open logs folder, which opens
 * the folder and shows the dialog again. Resolves true on Retry, false on any later button.
 */
async function retryDialog(message: string, detail: string, buttons: string[]): Promise<boolean> {
  const options: MessageBoxOptions = { type: 'error', message, detail, buttons, cancelId: 0 };
  for (;;) {
    const { response } = await dialog.showMessageBox(options);
    if (response === 0) return true;
    if (response !== 1) return false;
    await openLogs();
  }
}

function showWindow(): void {
  if (appUrl === undefined || stack === undefined) {
    startupWindow?.show();
    return;
  }
  appWindow ??= createAppWindow({
    createWindow: (options) => new BrowserWindow(options),
    origin: stack.origin,
    url: appUrl,
    openExternal: (url) => shell.openExternal(url),
    isQuitting: () => quit.quitting,
  });
  appWindow.show();
  appWindow.focus();
}

/** Runs a tray action, logging a failure, since a menu click has no caller to report it to. */
function inBackground(action: Promise<unknown>): void {
  action.catch((error: unknown) => log.error(error));
}

function renderTray(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate(
      trayMenu(trayState, {
        openWindow: showWindow,
        setOpenAtLogin: (on) => inBackground(setOpenAtLogin(on)),
        checkForUpdates: () => inBackground(autoUpdater.checkForUpdates()),
        applyUpdate: (offer) => inBackground(applyUpdate(offer)),
        openLogs: () => inBackground(openLogs()),
        quit: () => app.quit(),
      }),
    ),
  );
}

async function setOpenAtLogin(on: boolean): Promise<void> {
  await loginItem.set(on);
  trayState.openAtLogin = await loginItem.isOn();
  renderTray();
}

async function applyUpdate(offer: UpdateOffer): Promise<void> {
  if (offer.kind === 'download') await shell.openExternal(offer.url);
  else await quit.restartToUpdate(() => autoUpdater.quitAndInstall());
}

/** The window's `fetch`, so the desktop's calls carry the signed-in cookie. */
function sessionFetch(): SessionFetch {
  const partition = session.fromPartition(PARTITION);
  return (input, init) => partition.fetch(input, { ...init, credentials: 'include' });
}

/** Starts the stack and finds the first page: Get started until a GitHub App exists. */
async function startAndFindPage(): Promise<string> {
  stack = await startStack({
    paths,
    apiPort: API_PORT,
    postgresPort: POSTGRES_PORT,
    fork: forkNode,
    log,
    stopSystem: realStopSystem,
  });
  const client = createDesktopClient(stack.origin, sessionFetch());
  const status = await client.instance.getStatus();
  if (status.githubApp === 'configured') return `${stack.origin}/`;
  const token = encodeURIComponent(requireValue(stack.serverEnv, 'SETUP_TOKEN'));
  return `${stack.origin}/get-started#setup-token=${token}`;
}

/** Starts the stack, offering Retry, Open logs folder and Quit on a failure. */
async function startWithRetry(): Promise<boolean> {
  for (;;) {
    try {
      appUrl = await startAndFindPage();
      return true;
    } catch (error) {
      log.error(error);
      await stack?.stop();
      stack = undefined;
      const step = error instanceof StackStartError ? error.step : 'Open Plangineer';
      const reason = error instanceof Error ? error.message : String(error);
      const retry = await retryDialog('Plangineer could not start', `${step}: ${reason}`, [
        'Retry',
        'Open logs folder',
        'Quit',
      ]);
      if (!retry) return false;
    }
  }
}

function startPairing(origin: string, runnerEnv: Record<string, string>): RunnerPairing {
  const client = createDesktopClient(origin, sessionFetch());
  const pairingDialog = async (message: string) => {
    await retryDialog(message, `The logs are in ${paths.folders.log}.`, [
      'Retry',
      'Open logs folder',
    ]);
  };
  return startRunnerPairing({
    origin,
    runnerBundle: paths.runnerBundle,
    runnerEnv,
    hostname: os.hostname(),
    fork: forkNode,
    log,
    stopSystem: realStopSystem,
    fetch: sessionFetch(),
    approveLogin: (userCode) => client.runner.approveLogin({ userCode }),
    pairingFailed: pairingDialog,
    runnerKeepsStopping: pairingDialog,
  });
}

async function launch(): Promise<void> {
  if (!hidden) {
    startupWindow = createStartupWindow(
      (options) => new BrowserWindow(options),
      path.join(import.meta.dirname, 'startup.html'),
    );
  }
  const started = await startWithRetry();
  startupWindow?.destroy();
  startupWindow = undefined;
  if (!started || stack === undefined) {
    app.quit();
    return;
  }
  if (!hidden) showWindow();

  const runnerEnv = {
    PLANGINEER_RUNNER_DATA_DIR: paths.runnerData,
    ...(await runnerPathOverride(process.platform, () => shellEnv())),
  };
  pairing = startPairing(stack.origin, runnerEnv);

  if (app.isPackaged) {
    inBackground(turnOnLoginItem());
    startUpdates({
      platform: process.platform,
      updater: autoUpdater,
      log,
      onOffer: (offer) => {
        trayState.update = offer;
        renderTray();
      },
    });
  }
}

/** Turns Open at login on after the first successful start, and keeps it current after that. */
async function turnOnLoginItem(): Promise<void> {
  await refreshLoginItem(
    loginItem,
    await firstTime(path.join(paths.folders.config, 'open-at-login')),
  );
  trayState.openAtLogin = await loginItem.isOn();
  renderTray();
}

/** On macOS, asks once to move into /Applications, so the login item and updates have a stable path. */
async function offerMoveToApplications(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) return;
  if (!(await firstTime(path.join(paths.folders.config, 'asked-to-move')))) return;
  const { response } = await dialog.showMessageBox({
    message: 'Move Plangineer to your Applications folder?',
    detail: 'Open at login and updates need Plangineer to stay in one place.',
    buttons: ['Move to Applications', 'Not now'],
  });
  if (response === 0) app.moveToApplicationsFolder();
}

async function main(): Promise<void> {
  await app.whenReady();
  prepareSession(session.fromPartition(PARTITION), app.getVersion());
  await offerMoveToApplications();
  app.on('before-quit', (event) => quit.onBeforeQuit(event));
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  tray = new Tray(path.join(import.meta.dirname, 'tray-icon.png'));
  tray.setToolTip('Plangineer');
  tray.on('click', showWindow);
  renderTray();
  await launch();
}

if (app.requestSingleInstanceLock()) {
  main().catch((error: unknown) => {
    log.error(error);
    dialog.showErrorBox(
      'Plangineer stopped',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
} else {
  app.quit();
}

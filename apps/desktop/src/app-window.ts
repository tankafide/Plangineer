import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
  WebPreferences,
} from 'electron';
import { guardNavigation, restrictPermissions } from './navigation-policy.ts';

/** The one partition the window, its sign-in cookie and the desktop's API calls share. */
export const PARTITION = 'persist:plangineer';

type CreateWindow = (options: BrowserWindowConstructorOptions) => BrowserWindow;

function webPreferences(): WebPreferences {
  return {
    partition: PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  };
}

/** Denies every permission and names the app in the user agent. */
export function prepareSession(
  session: Session,
  appVersion: string,
  appOrigin: () => string | undefined,
): void {
  restrictPermissions(session, appOrigin);
  session.setUserAgent(`${session.getUserAgent()} Plangineer-Desktop/${appVersion}`);
}

/** The small window that shows "Starting Plangineer" while the stack starts. */
export function createStartupWindow(create: CreateWindow, startupPage: string): BrowserWindow {
  const window = create({
    width: 420,
    height: 260,
    resizable: false,
    title: 'Plangineer',
    webPreferences: webPreferences(),
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadFile(startupPage);
  return window;
}

export interface AppWindowOptions {
  createWindow: CreateWindow;
  origin: string;
  url: string;
  openExternal(url: string): Promise<void>;
  /** Closing hides the window until the app is quitting. */
  isQuitting(): boolean;
}

/** The app window on the API's origin. Closing it hides it, and the stack keeps running. */
export function createAppWindow(options: AppWindowOptions): BrowserWindow {
  const window = options.createWindow({
    width: 1280,
    height: 860,
    minWidth: 375,
    title: 'Plangineer',
    webPreferences: webPreferences(),
  });
  const openExternal = (url: string) => options.openExternal(url);
  guardNavigation(window.webContents, options.origin, openExternal);
  window.on('close', (event) => {
    if (options.isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
  void window.loadURL(options.url);
  return window;
}

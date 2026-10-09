import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The argument that starts the stack and tray with no window. */
export const HIDDEN_ARG = '--hidden';
const LAUNCH_AGENT_LABEL = 'io.github.tankafide.plangineer';

/** What the login item needs from Electron's `app` and the system. */
export interface LoginItemSystem {
  platform: NodeJS.Platform;
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  getLoginItemSettings(options: { args: string[] }): { openAtLogin: boolean };
  /** `app.getPath('exe')`, the app's executable on macOS. */
  executablePath: string;
  /** `process.env.APPIMAGE`, since `process.execPath` points into a temporary mount. */
  appImagePath: string | undefined;
  /** `app.getPath('home')`. */
  homeDir: string;
  /** `app.getPath('appData')`, `XDG_CONFIG_HOME` on Linux. */
  appDataDir: string;
}

export interface LoginItem {
  isOn(): Promise<boolean>;
  /** Turns it on or off. On, it is rewritten, so a moved app keeps working. */
  set(on: boolean): Promise<void>;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function launchAgentPlist(executablePath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCH_AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${escapeXml(executablePath)}</string>`,
    `    <string>${HIDDEN_ARG}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** A quoted `Exec` argument, escaped as the Desktop Entry spec sets for quotes and then values. */
function quoteExecArgument(argument: string): string {
  const quoted = `"${argument.replaceAll(/["`$\\]/g, (char) => `\\${char}`)}"`;
  return quoted.replaceAll('\\', '\\\\');
}

function autostartEntry(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Plangineer',
    `Exec=${quoteExecArgument(appImagePath)} ${HIDDEN_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** A login item kept as one file, written when on and removed when off. */
function fileLoginItem(file: string, contents: () => string): LoginItem {
  return {
    isOn: () => exists(file),
    async set(on) {
      if (!on) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents());
    },
  };
}

/**
 * The login item per system: `setLoginItemSettings` on Windows, a LaunchAgent on macOS, where
 * `setLoginItemSettings` can fail silently for an unsigned app, and an autostart entry on Linux.
 */
export function createLoginItem(system: LoginItemSystem): LoginItem {
  switch (system.platform) {
    case 'win32':
      return {
        isOn: async () => system.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin,
        async set(openAtLogin) {
          system.setLoginItemSettings({ openAtLogin, args: [HIDDEN_ARG] });
        },
      };
    case 'darwin':
      return fileLoginItem(
        path.join(system.homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`),
        () => launchAgentPlist(system.executablePath),
      );
    case 'linux':
      return fileLoginItem(path.join(system.appDataDir, 'autostart', 'plangineer.desktop'), () => {
        if (system.appImagePath === undefined) {
          throw new Error('Open at login needs the app to run as an AppImage');
        }
        return autostartEntry(system.appImagePath);
      });
    default:
      throw new Error(`Open at login is not supported on ${system.platform}`);
  }
}

/**
 * After a successful start: turns the login item on the first time (D21), and rewrites it while
 * it is on, so a moved app keeps working. `firstTime` reports whether this is the first time.
 */
export async function refreshLoginItem(loginItem: LoginItem, firstTime: boolean): Promise<void> {
  if (firstTime || (await loginItem.isOn())) await loginItem.set(true);
}

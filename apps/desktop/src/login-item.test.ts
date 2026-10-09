import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLoginItem, type LoginItemSystem, refreshLoginItem } from './login-item.ts';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

describe('createLoginItem', () => {
  let root: string;
  let windowsSettings: { openAtLogin: boolean; args: string[] }[];

  function system(platform: NodeJS.Platform, overrides: Partial<LoginItemSystem> = {}) {
    return {
      platform,
      setLoginItemSettings: (settings: { openAtLogin: boolean; args: string[] }) => {
        windowsSettings.push(settings);
      },
      getLoginItemSettings: () => ({ openAtLogin: windowsSettings.at(-1)?.openAtLogin ?? false }),
      executablePath: path.join(root, 'Plangineer.app', 'Contents', 'MacOS', 'Plangineer'),
      appImagePath: '/home/person/Apps/Plangineer-0.1.0.AppImage',
      homeDir: path.join(root, 'home'),
      appDataDir: path.join(root, 'config'),
      ...overrides,
    } satisfies LoginItemSystem;
  }

  const launchAgent = () =>
    path.join(root, 'home', 'Library', 'LaunchAgents', 'io.github.tankafide.plangineer.plist');
  const autostart = () => path.join(root, 'config', 'autostart', 'plangineer.desktop');

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'login-item-'));
    windowsSettings = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('writes a LaunchAgent on macOS that opens the app hidden at login, and removes it', async () => {
    const macos = system('darwin');
    const loginItem = createLoginItem(macos);

    await loginItem.set(true);

    const text = await readFile(launchAgent(), 'utf8');
    expect(text).toContain('<key>Label</key>\n  <string>io.github.tankafide.plangineer</string>');
    expect(text).toContain(
      `<array>\n    <string>${macos.executablePath}</string>\n    <string>--hidden</string>\n  </array>`,
    );
    expect(text).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(await loginItem.isOn()).toBe(true);

    await loginItem.set(false);

    expect(await exists(launchAgent())).toBe(false);
    expect(await loginItem.isOn()).toBe(false);
  });

  it('escapes the executable path in the LaunchAgent', async () => {
    const loginItem = createLoginItem(
      system('darwin', { executablePath: '/Apps/R&D <x>/Plangineer' }),
    );

    await loginItem.set(true);

    expect(await readFile(launchAgent(), 'utf8')).toContain(
      '<string>/Apps/R&amp;D &lt;x&gt;/Plangineer</string>',
    );
  });

  it('writes an autostart entry on Linux that runs the AppImage hidden, and removes it', async () => {
    const loginItem = createLoginItem(system('linux'));

    await loginItem.set(true);

    expect((await readFile(autostart(), 'utf8')).split('\n')).toEqual([
      '[Desktop Entry]',
      'Type=Application',
      'Name=Plangineer',
      'Exec="/home/person/Apps/Plangineer-0.1.0.AppImage" --hidden',
      'X-GNOME-Autostart-enabled=true',
      '',
    ]);
    expect(await loginItem.isOn()).toBe(true);

    await loginItem.set(false);

    expect(await exists(autostart())).toBe(false);
  });

  it('escapes quotes and dollar signs in the AppImage path as the Desktop Entry spec sets', async () => {
    const loginItem = createLoginItem(system('linux', { appImagePath: '/apps/"$X"/P.AppImage' }));

    await loginItem.set(true);

    // Each is escaped once inside the quoted argument, and that backslash again in the value.
    expect(await readFile(autostart(), 'utf8')).toContain(
      String.raw`Exec="/apps/\\"\\$X\\"/P.AppImage" --hidden`,
    );
  });

  it('refuses to turn on at login on Linux outside an AppImage', async () => {
    const loginItem = createLoginItem(system('linux', { appImagePath: undefined }));

    await expect(loginItem.set(true)).rejects.toThrow(
      'Open at login needs the app to run as an AppImage',
    );
  });

  it('uses setLoginItemSettings with --hidden on Windows', async () => {
    const loginItem = createLoginItem(system('win32'));

    await loginItem.set(true);
    expect(await loginItem.isOn()).toBe(true);
    await loginItem.set(false);

    expect(windowsSettings).toEqual([
      { openAtLogin: true, args: ['--hidden'] },
      { openAtLogin: false, args: ['--hidden'] },
    ]);
    expect(await loginItem.isOn()).toBe(false);
  });
});

/** A login item that records each set. */
function recordingItem(on: boolean) {
  const sets: boolean[] = [];
  const item = {
    isOn: async () => on,
    set: async (value: boolean) => {
      sets.push(value);
    },
  };
  return { item, sets };
}

describe('refreshLoginItem', () => {
  it('turns the login item on after the first successful start', async () => {
    const { item, sets } = recordingItem(false);

    await refreshLoginItem(item, true);

    expect(sets).toEqual([true]);
  });

  it('rewrites a login item that is on, so a moved app keeps working', async () => {
    const { item, sets } = recordingItem(true);

    await refreshLoginItem(item, false);

    expect(sets).toEqual([true]);
  });

  it('leaves a login item the person turned off alone', async () => {
    const { item, sets } = recordingItem(false);

    await refreshLoginItem(item, false);

    expect(sets).toEqual([]);
  });
});

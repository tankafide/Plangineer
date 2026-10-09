import type { UpdateOffer } from './updates.ts';

/** The fields of Electron's `MenuItemConstructorOptions` the tray uses. */
export interface TrayMenuItem {
  label: string;
  type?: 'checkbox';
  checked?: boolean;
  enabled?: boolean;
  click(): void;
}

export interface TrayState {
  /** Open at login and updates exist only in the packaged app. */
  packaged: boolean;
  openAtLogin: boolean;
  update: UpdateOffer | undefined;
}

export interface TrayActions {
  openWindow(): void;
  setOpenAtLogin(on: boolean): void;
  checkForUpdates(): void;
  applyUpdate(offer: UpdateOffer): void;
  openLogs(): void;
  quit(): void;
}

function updateLabel(offer: UpdateOffer): string {
  return offer.kind === 'restart'
    ? `Restart to update to ${offer.version}`
    : `Download Plangineer ${offer.version}`;
}

/** The tray menu, which holds every action so nothing needs the window. */
export function trayMenu(state: TrayState, actions: TrayActions): TrayMenuItem[] {
  const { update } = state;
  return [
    { label: 'Open Plangineer', click: () => actions.openWindow() },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: state.openAtLogin,
      enabled: state.packaged,
      click: () => actions.setOpenAtLogin(!state.openAtLogin),
    },
    { label: 'Check for updates', enabled: state.packaged, click: () => actions.checkForUpdates() },
    ...(update === undefined
      ? []
      : [{ label: updateLabel(update), click: () => actions.applyUpdate(update) }]),
    { label: 'Open logs folder', click: () => actions.openLogs() },
    { label: 'Quit Plangineer', click: () => actions.quit() },
  ];
}

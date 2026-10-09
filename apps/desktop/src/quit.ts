import type { DesktopLog } from './desktop-log.ts';

export interface QuitOptions {
  /** `app.quit`, called again once the stack has stopped. */
  quit(): void;
  /** Stops the runner, the API and Postgres. */
  stopStack(): Promise<void>;
  log: DesktopLog;
}

export interface QuitController {
  /** True from the first quit request, so closing the window then quits instead of hiding. */
  readonly quitting: boolean;
  /** The `before-quit` handler. */
  onBeforeQuit(event: { preventDefault(): void }): void;
  /** Stops the stack, then installs the downloaded update and restarts. */
  restartToUpdate(quitAndInstall: () => void): Promise<void>;
}

/**
 * Electron never awaits an async `before-quit` handler. So while the stack runs, the quit is
 * held with `preventDefault`, the stack stops, and `app.quit()` runs again, which now passes.
 * An update installed on quit runs after the same stop, so no process holds a file it replaces.
 */
export function createQuitController(options: QuitOptions): QuitController {
  let state: 'running' | 'stopping' | 'stopped' = 'running';

  async function stop(): Promise<void> {
    state = 'stopping';
    try {
      await options.stopStack();
    } catch (error) {
      options.log.error(error);
    }
    state = 'stopped';
  }

  return {
    get quitting() {
      return state !== 'running';
    },
    onBeforeQuit(event) {
      if (state === 'stopped') return;
      event.preventDefault();
      if (state === 'stopping') return;
      void stop().then(() => options.quit());
    },
    async restartToUpdate(quitAndInstall) {
      if (state !== 'running') return;
      await stop();
      quitAndInstall();
    },
  };
}

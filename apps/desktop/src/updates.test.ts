import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLog } from './test/memory-log.ts';
import { startUpdates, type UpdateOffer, type Updater } from './updates.ts';

/** An autoUpdater that counts checks and emits the events electron-updater emits. */
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  logger: Updater['logger'] = null;
  checks = 0;

  async checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    return null;
  }
}

function start(platform: NodeJS.Platform) {
  const updater = new FakeUpdater();
  const log = memoryLog();
  const offers: UpdateOffer[] = [];
  startUpdates({ platform, updater, log, onOffer: (offer) => offers.push(offer) });
  return { updater, offers, log };
}

describe('startUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('on macOS downloads nothing and offers the release page of a found update', () => {
    const { updater, offers } = start('darwin');

    expect(updater.autoDownload).toBe(false);
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('update-downloaded', { version: '0.2.0' });

    expect(offers).toEqual([
      {
        kind: 'download',
        version: '0.2.0',
        url: 'https://github.com/tankafide/Plangineer/releases/tag/v0.2.0',
      },
    ]);
  });

  it.each(['win32', 'linux'] as const)(
    'on %s downloads a found update and offers a restart once it is downloaded',
    (platform) => {
      const { updater, offers } = start(platform);

      expect(updater.autoDownload).toBe(true);
      updater.emit('update-available', { version: '0.2.0' });
      expect(offers).toEqual([]);
      updater.emit('update-downloaded', { version: '0.2.0' });

      expect(offers).toEqual([{ kind: 'restart', version: '0.2.0' }]);
    },
  );

  it('logs through the desktop log and checks at start and every 6 hours', async () => {
    const { updater, log } = start('linux');

    expect(updater.logger).toBe(log);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checks).toBe(2);
  });
});

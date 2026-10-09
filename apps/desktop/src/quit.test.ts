import { setImmediate as tick } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createQuitController } from './quit.ts';
import { memoryLog } from './test/memory-log.ts';

/** A quit controller whose stack stop the test finishes, recording what happens in order. */
function setup() {
  const events: string[] = [];
  const { promise: stopped, resolve: finishStop } = Promise.withResolvers<void>();
  const controller = createQuitController({
    quit: () => events.push('app.quit'),
    stopStack: async () => {
      events.push('stopStack started');
      await stopped;
      events.push('stopStack resolved');
    },
    log: memoryLog(),
  });
  function beforeQuit(): boolean {
    let prevented = false;
    controller.onBeforeQuit({ preventDefault: () => (prevented = true) });
    return prevented;
  }
  return { controller, events, finishStop, beforeQuit };
}

describe('createQuitController', () => {
  it('holds the quit until stopStack resolves, then quits again and lets it pass', async () => {
    const { controller, events, finishStop, beforeQuit } = setup();

    expect(beforeQuit()).toBe(true);
    expect(controller.quitting).toBe(true);
    expect(beforeQuit()).toBe(true);
    await tick();
    expect(events).toEqual(['stopStack started']);

    finishStop();
    await tick();

    expect(events).toEqual(['stopStack started', 'stopStack resolved', 'app.quit']);
    expect(beforeQuit()).toBe(false);
  });

  it('calls quitAndInstall only after stopStack resolves', async () => {
    const { controller, events, finishStop, beforeQuit } = setup();

    const restarting = controller.restartToUpdate(() => events.push('quitAndInstall'));
    await tick();
    expect(events).toEqual(['stopStack started']);

    finishStop();
    await restarting;

    expect(events).toEqual(['stopStack started', 'stopStack resolved', 'quitAndInstall']);
    // quitAndInstall quits the app, which now finds the stack stopped and passes.
    expect(beforeQuit()).toBe(false);
  });

  it('quits even when the stack fails to stop', async () => {
    const events: string[] = [];
    const controller = createQuitController({
      quit: () => events.push('app.quit'),
      stopStack: () => Promise.reject(new Error('pg_ctl failed')),
      log: memoryLog(),
    });

    controller.onBeforeQuit({ preventDefault: () => {} });
    await tick();

    expect(events).toEqual(['app.quit']);
  });

  it('is not quitting before a quit starts, so closing the window hides it', () => {
    const { controller } = setup();

    expect(controller.quitting).toBe(false);
  });
});

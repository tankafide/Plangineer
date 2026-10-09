import { describe, expect, it } from 'vitest';
import type { LocalStack } from './stack.ts';
import { createStackSlot } from './stack-slot.ts';

/** A stack that counts its stops. */
function fakeStack() {
  const stack = {
    stops: 0,
    serverEnv: {},
    origin: 'http://127.0.0.1:1',
    stop: async () => {
      stack.stops += 1;
    },
  } satisfies LocalStack & { stops: number };
  return stack;
}

describe('createStackSlot', () => {
  it('waits for a start in progress, then stops the stack it started', async () => {
    const slot = createStackSlot();
    const stack = fakeStack();
    const start = Promise.withResolvers<LocalStack>();
    const started = slot.start(() => start.promise);

    const stopped = slot.stop();
    expect(stack.stops).toBe(0);
    start.resolve(stack);
    await started;
    await stopped;

    expect(stack.stops).toBe(1);
    expect(slot.stack).toBeUndefined();
  });

  it('stops nothing after a failed start', async () => {
    const slot = createStackSlot();
    const failed = slot.start(() => Promise.reject(new Error('Postgres did not start')));

    await expect(slot.stop()).resolves.toBeUndefined();
    await expect(failed).rejects.toThrow('Postgres did not start');
    expect(slot.stack).toBeUndefined();
  });

  it('stops a running stack once', async () => {
    const slot = createStackSlot();
    const stack = fakeStack();
    await slot.start(() => Promise.resolve(stack));

    await slot.stop();
    await slot.stop();

    expect(stack.stops).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerPairing } from './runner-pairing.ts';
import { login, ORIGIN, RUNNER_ID, settle, setup } from './test/fake-runner.ts';

describe('startRunnerPairing', () => {
  let pairing: RunnerPairing | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const stopping = pairing?.stop();
    await settle();
    await stopping;
    pairing = undefined;
    vi.useRealTimers();
  });

  it('starts the runner against the API origin', async () => {
    const harness = setup();
    pairing = harness.pairing;
    await settle();

    expect(harness.latest().args).toEqual(['start', '--server', ORIGIN]);
  });

  it('pairs a runner that exits with code 3 as the signed-in user, then starts it again', async () => {
    const harness = setup();
    pairing = harness.pairing;
    await settle();

    harness.latest().exit(3);
    await settle();
    expect(harness.latest().args).toEqual([
      'login',
      '--server',
      ORIGIN,
      '--name',
      'workstation',
      '--json',
    ]);
    await login(harness.latest(), 'ABCD-1234');
    harness.latest().print({ event: 'paired', runnerId: RUNNER_ID });
    harness.latest().exit(0);
    await settle();

    expect(harness.approved).toEqual(['ABCD-1234']);
    expect(harness.commands()).toEqual(['start', 'login', 'start']);
    expect(harness.latest().args).toEqual(['start', '--server', ORIGIN]);
  });

  it('waits for a sign-in in the window before it pairs', async () => {
    let signedIn = false;
    const harness = setup({ signedIn: () => signedIn });
    pairing = harness.pairing;
    await settle();

    harness.latest().exit(3);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(harness.commands()).toEqual(['start']);

    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();

    expect(harness.commands()).toEqual(['start', 'login']);
  });

  it('starts a runner that exits with code 1 again after 5 s', async () => {
    const harness = setup();
    pairing = harness.pairing;
    await settle();

    harness.latest().exit(1, 'replaced by another connection');
    await settle();
    await vi.advanceTimersByTimeAsync(4_999);
    await settle();
    expect(harness.commands()).toEqual(['start']);

    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(harness.commands()).toEqual(['start', 'start']);
  });

  it('shows the dialog after 5 exits with code 1 in a row, and Retry starts the runner again', async () => {
    const harness = setup();
    pairing = harness.pairing;
    await settle();

    for (let exit = 1; exit <= 5; exit += 1) {
      harness.latest().exit(1, `protocol error ${exit}`);
      await settle();
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
    }

    expect(harness.commands()).toEqual(['start', 'start', 'start', 'start', 'start']);
    expect(harness.dialogs).toEqual(["This computer's runner keeps stopping: protocol error 5"]);

    harness.clickRetry();
    await settle();

    expect(harness.commands()).toHaveLength(6);
    expect(harness.latest().args).toEqual(['start', '--server', ORIGIN]);
  });

  it('retries a pairing whose approve call fails on the next poll, and stops the login', async () => {
    const harness = setup({
      approve: () => Promise.reject(new Error('Forbidden')),
    });
    pairing = harness.pairing;
    await settle();
    harness.latest().exit(3);
    await settle();

    await login(harness.latest(), 'CODE-0001');

    expect(harness.latest().exitCode).toBe(143);
    expect(harness.commands()).toEqual(['start', 'login']);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(harness.commands()).toEqual(['start', 'login', 'login']);
    expect(harness.dialogs).toEqual([]);
  });

  it('shows the dialog after 3 failed pairings in a row, and Retry starts the count again', async () => {
    const harness = setup({
      approve: () => Promise.reject(new Error('Forbidden')),
    });
    pairing = harness.pairing;
    await settle();
    harness.latest().exit(3);
    await settle();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await login(harness.latest(), `CODE-000${attempt}`);
      await vi.advanceTimersByTimeAsync(2_000);
      await settle();
    }

    const dialog =
      "This computer's runner could not be paired: The login request could not be approved: Forbidden";
    expect(harness.dialogs).toEqual([dialog]);
    expect(harness.commands()).toEqual(['start', 'login', 'login', 'login']);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(harness.commands()).toHaveLength(4);

    harness.clickRetry();
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(harness.commands()).toEqual(['start', 'login', 'login', 'login', 'login']);

    // Two more failures after Retry are not three in a row, so no second dialog.
    for (let attempt = 4; attempt <= 5; attempt += 1) {
      await login(harness.latest(), `CODE-000${attempt}`);
      await vi.advanceTimersByTimeAsync(2_000);
      await settle();
    }
    expect(harness.dialogs).toEqual([dialog]);
  });

  it('counts a failed login event and a nonzero login exit as failed pairings', async () => {
    const harness = setup();
    pairing = harness.pairing;
    await settle();
    harness.latest().exit(3);
    await settle();

    harness.latest().print({ event: 'failed', message: 'The pairing was denied in Plangineer.' });
    harness.latest().exit(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    harness.latest().exit(1, 'connect ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    harness.latest().print({ event: 'failed', message: 'The pairing request expired.' });
    harness.latest().exit(1);
    await settle();

    expect(harness.dialogs).toEqual([
      "This computer's runner could not be paired: The pairing request expired.",
    ]);
  });

  it('stops the runner and every retry', async () => {
    const harness = setup();
    await settle();
    const running = harness.latest();

    const stopping = harness.pairing.stop();
    await settle();
    await stopping;
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(running.exitCode).toBe(143);
    expect(harness.commands()).toEqual(['start']);
  });
});

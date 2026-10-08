import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { isProcessRunning } from '../test/fake-agent.ts';
import { stopProcess, taskkillArgs, trackProcess } from './stop-process.ts';

describe('taskkillArgs', () => {
  it('force-stops the process and its tree on Windows', () => {
    expect(taskkillArgs(4242)).toEqual(['/pid', '4242', '/T', '/F']);
  });
});

describe('stopProcess', () => {
  it('stops a detached child and resolves once it has exited', async () => {
    const child = execa(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
      detached: process.platform !== 'win32',
      reject: false,
    });
    const running = trackProcess(child);
    const pid = child.pid;
    if (pid === undefined) throw new Error('the child did not start');

    await stopProcess(running);

    expect(running.hasExited()).toBe(true);
    expect(isProcessRunning(pid)).toBe(false);
  });

  it('returns at once for a child that has already exited', async () => {
    const child = execa(process.execPath, ['-e', ''], { reject: false });
    const running = trackProcess(child);
    await running.exited;

    await expect(stopProcess(running)).resolves.toBeUndefined();
  });
});

import { fileURLToPath } from 'node:url';
import type { RunnerRunEventBody } from '@plangineer/contracts';
import { z } from 'zod';

/** The Claude Code command that runs the fake agent instead of a model. */
export const FAKE_CLAUDE_COMMAND = [
  process.execPath,
  fileURLToPath(new URL('../adapters/claude-code/fake-claude.ts', import.meta.url)),
];

const FakeProcesses = z.object({ pid: z.int(), grandchildPid: z.int() });

/** The pids a `hang` run of the fake agent reports, from its `fake_processes` event. */
export function fakeProcessIds(events: RunnerRunEventBody[]): number[] | null {
  const event = events.find(
    (candidate) => candidate.type === 'agent.other' && candidate.vendorType === 'fake_processes',
  );
  if (event?.type !== 'agent.other') return null;
  const { pid, grandchildPid } = FakeProcesses.parse(JSON.parse(event.json));
  return [pid, grandchildPid];
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

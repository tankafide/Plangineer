import type { RunnerStatus } from '@plangineer/contracts';

interface RunnerCandidate {
  id: string;
  status: RunnerStatus;
  lastSeenAt: string | null;
}

/**
 * The non-revoked runner seen most recently, which on the desktop is the bundled runner. A runner
 * never seen comes last, and ties go to the lower id.
 */
export function pickRunner(runners: RunnerCandidate[]): string | null {
  const seenAt = (runner: RunnerCandidate) =>
    runner.lastSeenAt === null ? -Infinity : Date.parse(runner.lastSeenAt);
  const [best] = runners
    .filter((runner) => runner.status !== 'revoked')
    .toSorted((a, b) => seenAt(b) - seenAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return best?.id ?? null;
}

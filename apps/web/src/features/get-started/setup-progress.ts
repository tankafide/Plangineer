import type { Runner } from '@plangineer/contracts';

/** Where Claude Code stands on the signed-in user's runners, for the get-started checklist. */
export type ClaudeCodeProgress =
  | { state: 'no-runner' }
  | { state: 'done'; runner: string; version: string }
  | { state: 'unavailable'; runner: string }
  | { state: 'offline'; runner: string };

function claudeCodeVersion(runner: Runner): string | null {
  const cli = runner.clis.find((status) => status.name === 'claude-code');
  return cli?.available === true ? cli.version : null;
}

/** The candidate whose runner was seen most recently. A runner never seen sorts last. */
function latestSeen<T extends { runner: Runner }>(candidates: readonly T[]): T | undefined {
  return candidates.reduce<T | undefined>(
    (latest, candidate) =>
      latest === undefined || (candidate.runner.lastSeenAt ?? '') > (latest.runner.lastSeenAt ?? '')
        ? candidate
        : latest,
    undefined,
  );
}

/**
 * Done wins when an online runner has Claude Code available. Otherwise Claude Code is unavailable
 * when a runner is online, and offline when none is. Revoked runners never count.
 */
export function claudeCodeProgress(runners: readonly Runner[]): ClaudeCodeProgress {
  const active = runners
    .filter((runner) => runner.status === 'active')
    .map((runner) => ({ runner }));
  const online = active.filter(({ runner }) => runner.online);
  const ready = latestSeen(
    online.flatMap(({ runner }) => {
      const version = claudeCodeVersion(runner);
      return version === null ? [] : [{ runner, version }];
    }),
  );
  if (ready !== undefined) {
    return { state: 'done', runner: ready.runner.name, version: ready.version };
  }
  const reachable = latestSeen(online);
  if (reachable !== undefined) return { state: 'unavailable', runner: reachable.runner.name };
  const known = latestSeen(active);
  if (known !== undefined) return { state: 'offline', runner: known.runner.name };
  return { state: 'no-runner' };
}

/** The desktop app adds ` Plangineer-Desktop/<version>` to its window's user agent. */
export function isDesktopApp(): boolean {
  return navigator.userAgent.includes(' Plangineer-Desktop/');
}

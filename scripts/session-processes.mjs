import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';

/** How often the process table is read while a session runs. */
const POLL_MS = 10_000;
/** Process start times have one-second resolution, so a child can look a second older. */
const CLOCK_SLACK_MS = 1_000;
/** taskkill's exit code when the process has already exited. */
const TASKKILL_NOT_FOUND = 128;
/**
 * Docker Desktop is shared with `pnpm dev` and the tests, and a forced stop corrupts it, so it and
 * everything it starts are never stopped, even when a session started it.
 */
const KEEP = /docker/i;

const WINDOWS_LIST = [
  '@(Get-CimInstance Win32_Process | Where-Object CreationDate | ForEach-Object {',
  '[pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId;',
  "started = $_.CreationDate.ToUniversalTime().ToString('o'); name = $_.Name } })",
  '| ConvertTo-Json -Compress',
].join(' ');

/** Every process as `{ pid, ppid, started, name }`, with `started` in epoch milliseconds. */
export async function listProcesses() {
  if (process.platform === 'win32') {
    const { stdout } = await execa('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_LIST,
    ]);
    return JSON.parse(stdout).map((row) => ({ ...row, started: Date.parse(row.started) }));
  }
  // lstart is always five words in the C locale, so the command name is the rest of the line.
  const { stdout } = await execa('ps', ['-A', '-o', 'pid=,ppid=,lstart=,comm='], {
    env: { LC_ALL: 'C' },
  });
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [pid, ppid, ...rest] = line.trim().split(/\s+/);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        started: Date.parse(rest.slice(0, 5).join(' ')),
        name: rest.slice(5).join(' '),
      };
    });
}

/**
 * Updates tracked (pid to `{ started, goneAt }`) from table, read at now. A tracked pid that now
 * belongs to another process was reused, so it is dropped. A tracked pid that is gone is stamped
 * with the first read that missed it, and only a process started before then can be its child.
 * Then each process a tracked one started after since is added, except Docker and what it starts.
 */
export function updateTracked(tracked, table, { since, now }) {
  const alive = new Map(table.map((row) => [row.pid, row.started]));
  for (const [pid, entry] of tracked) {
    if (!alive.has(pid)) entry.goneAt ??= now;
    else if (alive.get(pid) !== entry.started) tracked.delete(pid);
  }
  const startedByTracked = (row) => {
    const parent = tracked.get(row.ppid);
    if (parent === undefined) return false;
    return alive.has(row.ppid) || row.started < parent.goneAt + CLOCK_SLACK_MS;
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (tracked.has(row.pid) || !startedByTracked(row)) continue;
      if (row.started < since - CLOCK_SLACK_MS || KEEP.test(row.name)) continue;
      tracked.set(row.pid, { started: row.started, goneAt: undefined });
      grew = true;
    }
  }
}

async function stopProcess(pid) {
  if (process.platform === 'win32') {
    // No /T: the tree is already known, and taskkill's own tree walk would reach Docker.
    const result = await execa('taskkill', ['/pid', String(pid), '/F'], { reject: false });
    if (result.exitCode !== 0 && result.exitCode !== TASKKILL_NOT_FOUND) throw result;
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/**
 * Tracks every process a session starts, by reading the process table while it runs, since an
 * orphan loses its parent on macOS and Linux. A process launched through a shell that exits
 * between two reads is missed, so sessions start background processes as children that stay.
 * `stop` ends the watch and stops each tracked process still running. It returns their pids and
 * every failure to read or stop, which never stops the cleanup.
 */
export function trackSessionProcesses(
  rootPid,
  { pollMs = POLL_MS, listProcesses: list = listProcesses } = {},
) {
  const since = Date.now();
  const tracked = new Map();
  const failures = [];
  const ended = new AbortController();
  const read = async () => {
    const table = await list();
    if (!tracked.has(rootPid)) {
      const root = table.find((row) => row.pid === rootPid);
      tracked.set(rootPid, { started: root?.started, goneAt: undefined });
    }
    updateTracked(tracked, table, { since, now: Date.now() });
    return table;
  };
  const readOrRecord = () =>
    read().catch((error) => {
      failures.push(`Could not read the process table: ${error.message}`);
      return [];
    });
  const polling = (async () => {
    while (!ended.signal.aborted) {
      await readOrRecord();
      await delay(pollMs, undefined, { signal: ended.signal }).catch(() => {});
    }
  })();

  return {
    async stop() {
      ended.abort();
      await polling;
      const running = (await readOrRecord()).filter(
        (row) => row.pid !== rootPid && tracked.get(row.pid)?.started === row.started,
      );
      const stopped = [];
      for (const { pid } of running) {
        try {
          await stopProcess(pid);
          stopped.push(pid);
        } catch (error) {
          failures.push(`Could not stop process ${pid}: ${error.message}`);
        }
      }
      return { stopped, failures };
    },
  };
}

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
 * Adds to tracked (pid to start time) each process in table that a tracked process started after
 * since. A tracked parent whose pid now belongs to a newer process was reused, so its pid no
 * longer counts. Docker processes and their children are left out.
 */
export function addDescendants(tracked, table, since) {
  const alive = new Map(table.map((row) => [row.pid, row.started]));
  const isParent = (pid) =>
    tracked.has(pid) && (!alive.has(pid) || tracked.get(pid) === alive.get(pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (tracked.has(row.pid) || !isParent(row.ppid)) continue;
      if (row.started < since - CLOCK_SLACK_MS || KEEP.test(row.name)) continue;
      tracked.set(row.pid, row.started);
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
 * orphan loses its parent on macOS and Linux. `stop` ends the watch and stops each tracked process
 * still running, then returns their pids.
 */
export function trackSessionProcesses(rootPid, { pollMs = POLL_MS } = {}) {
  const since = Date.now();
  const tracked = new Map();
  const ended = new AbortController();
  const read = async () => {
    const table = await listProcesses();
    if (!tracked.has(rootPid)) {
      tracked.set(rootPid, table.find((row) => row.pid === rootPid)?.started);
    }
    addDescendants(tracked, table, since);
    return table;
  };
  const polling = (async () => {
    while (!ended.signal.aborted) {
      await read();
      await delay(pollMs, undefined, { signal: ended.signal }).catch(() => {});
    }
  })();
  // A failed read surfaces from stop, not as an unhandled rejection while the session runs.
  polling.catch(() => {});

  return {
    async stop() {
      ended.abort();
      await polling;
      const table = await read();
      const running = table.filter(
        (row) => row.pid !== rootPid && tracked.get(row.pid) === row.started,
      );
      for (const row of running) await stopProcess(row.pid);
      return running.map((row) => row.pid);
    },
  };
}

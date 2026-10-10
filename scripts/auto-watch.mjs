import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';
import { OUTCOME_FILE } from './auto-run.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const POLL_MS = 15_000;
const SESSION_LOG = /^(plan|implementation)\.jsonl$/;

async function head(cwd) {
  return (await execa('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}

async function sessionLogs(logDir) {
  return (await readdir(logDir)).filter((name) => SESSION_LOG.test(name));
}

/** The milestone a session's stream event marks, or undefined for any other event. */
export function sessionMilestone(session, event) {
  if (event.type === 'system' && event.subtype === 'init') return `Session started: ${session}`;
  if (event.type !== 'result') return undefined;
  if (event.is_error || event.subtype !== 'success') {
    return `Session failed: ${session}: ${[event.subtype, event.result].filter(Boolean).join(': ')}`;
  }
  const report = event.structured_output?.report;
  const reason = report?.outcome === 'stopped' ? `: ${report.stopReason}` : '';
  return `Session ended: ${session}: ${report?.outcome}${reason}`;
}

/** The last line, for the run's outcome as auto-run writes it. */
export function runMilestone(outcome) {
  if (outcome.error !== undefined) return `Run failed: ${outcome.error}`;
  if (outcome.ready) return 'Run finished: ready to land';
  return `Run finished: not ready, ${outcome.reasons.length} reasons to read in its output`;
}

/**
 * Starts watching the auto run logging to logDir. Each `poll` returns the milestones since the
 * last one, beginning from now: each new commit in cwd, each session's start and end, and the
 * run's end, after which `ended` is true.
 */
export async function startWatch({ cwd, logDir }) {
  let seen = await head(cwd);
  const offsets = new Map();
  for (const name of await sessionLogs(logDir)) {
    offsets.set(name, (await stat(path.join(logDir, name))).size);
  }

  async function newCommits() {
    const current = await head(cwd);
    if (current === seen) return [];
    const range = `${seen}..${current}`;
    seen = current;
    const { stdout } = await execa('git', ['log', '--reverse', '--format=%h %s', range], { cwd });
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `Commit: ${line}`);
  }

  async function newSessionMilestones(name) {
    const read = offsets.get(name) ?? 0;
    const unread = (await readFile(path.join(logDir, name))).subarray(read);
    const complete = unread.subarray(0, unread.lastIndexOf(0x0a) + 1);
    offsets.set(name, read + complete.length);
    const session = path.basename(name, '.jsonl');
    return complete
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => sessionMilestone(session, JSON.parse(line)))
      .filter((milestone) => milestone !== undefined);
  }

  return {
    async poll() {
      const lines = await newCommits();
      for (const name of await sessionLogs(logDir))
        lines.push(...(await newSessionMilestones(name)));
      const outcome = await readFile(path.join(logDir, OUTCOME_FILE), 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (outcome !== undefined) lines.push(runMilestone(JSON.parse(outcome)));
      return { lines, ended: outcome !== undefined };
    },
  };
}

/** Prints each milestone of the auto run logging to logDir as one line, until the run ends. */
async function watchRun(logDir) {
  const watch = await startWatch({ cwd: repoRoot, logDir });
  for (;;) {
    const { lines, ended } = await watch.poll();
    for (const line of lines) console.log(line);
    if (ended) return;
    await delay(POLL_MS);
  }
}

if (isEntryPoint(import.meta.url)) {
  const [logDir] = process.argv.slice(2);
  if (logDir === undefined) {
    reportFailure(new Error('Pass the log folder auto-run printed: pnpm auto:watch <log folder>'));
  } else {
    await watchRun(path.resolve(logDir)).catch(reportFailure);
  }
}

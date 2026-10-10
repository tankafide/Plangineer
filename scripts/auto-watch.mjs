import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';
import { z } from 'zod';
import { Outcome, OUTCOME_FILE, RUN_FILE, RunFile } from './auto-run.mjs';
import {
  ImplementationReport,
  InitEvent,
  PlanReport,
  ResultEvent,
  reportOutput,
} from './auto-run-session.mjs';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const POLL_MS = 15_000;
const SESSION_LOG = /^(plan|implementation)\.jsonl$/;
/** Where the watcher keeps its place, so a restarted watcher repeats and misses nothing. */
const CURSOR_FILE = 'watch.json';
const REPORTS = { plan: PlanReport, implementation: ImplementationReport };

const Cursor = z.strictObject({
  commit: z.string().min(1),
  offsets: z.record(z.string(), z.number().int().nonnegative()),
});

async function readJson(file, schema) {
  const text = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  return text === undefined ? undefined : schema.parse(JSON.parse(text));
}

/** The milestone a session's stream event marks, or undefined for any other event. */
export function sessionMilestone(session, event) {
  if (InitEvent.safeParse(event).success) return `Session started: ${session}`;
  if (event.type !== 'result') return undefined;
  const result = ResultEvent.safeParse(event);
  if (!result.success)
    return `Session failed: ${session}: its result event has an unexpected shape`;
  const { subtype, is_error: isError, result: message, structured_output } = result.data;
  if (isError || subtype !== 'success') {
    return `Session failed: ${session}: ${[subtype, message].filter(Boolean).join(': ')}`;
  }
  const output = reportOutput(REPORTS[session]).safeParse(structured_output);
  if (!output.success) return `Session failed: ${session}: its report does not match its schema`;
  const { report } = output.data;
  const reason = report.outcome === 'stopped' ? `: ${report.stopReason}` : '';
  return `Session ended: ${session}: ${report.outcome}${reason}`;
}

/** The last line, for the run's outcome as auto-run writes it. */
export function runMilestone(outcome) {
  if ('error' in outcome) return `Run failed: ${outcome.error}`;
  if (outcome.ready) return 'Run finished: ready to land';
  return `Run finished: not ready, ${outcome.reasons.length} reasons to read in its output`;
}

/**
 * Starts watching the auto run logging to logDir, from where an earlier watcher of the same run
 * stopped, or else from the run's start. Each `poll` returns the milestones since the last one:
 * each new commit in cwd, each session's start and end, and the run's end, after which `ended`
 * is true.
 */
export async function startWatch({ cwd, logDir }) {
  const cursorFile = path.join(logDir, CURSOR_FILE);
  const cursor = (await readJson(cursorFile, Cursor)) ?? {
    commit: (await readJson(path.join(logDir, RUN_FILE), RunFile)).baseCommit,
    offsets: {},
  };

  async function newCommits() {
    const { stdout: head } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    if (head === cursor.commit) return [];
    const range = `${cursor.commit}..${head}`;
    cursor.commit = head;
    const { stdout } = await execa('git', ['log', '--reverse', '--format=%h %s', range], { cwd });
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `Commit: ${line}`);
  }

  async function newSessionMilestones(name) {
    const read = cursor.offsets[name] ?? 0;
    const unread = (await readFile(path.join(logDir, name))).subarray(read);
    const complete = unread.subarray(0, unread.lastIndexOf(0x0a) + 1);
    cursor.offsets[name] = read + complete.length;
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
      const logs = (await readdir(logDir)).filter((name) => SESSION_LOG.test(name));
      for (const name of logs) lines.push(...(await newSessionMilestones(name)));
      const outcome = await readJson(path.join(logDir, OUTCOME_FILE), Outcome);
      if (outcome !== undefined) lines.push(runMilestone(outcome));
      await writeFile(cursorFile, JSON.stringify(cursor));
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

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunJob, RunnerRunEventBody, RunnerToServerMessage } from '@plangineer/contracts';
import { pino } from 'pino';
import type { AgentAdapter } from '../adapters/agent-adapter.ts';
import { createClaudeCodeAdapter } from '../adapters/claude-code/claude-code-adapter.ts';
import { writeCredentials } from '../config/runner-credentials.ts';
import { parseRunnerEnv, type RunnerEnv } from '../config/runner-env.ts';
import { runnerPaths } from '../config/runner-paths.ts';
import { startRunner } from '../start-command.ts';
import { FAKE_CLAUDE_COMMAND, fakeProcessIds } from './fake-agent.ts';
import type { FakeControlPlane } from './fake-control-plane.ts';

export const TEST_REPOSITORY = { owner: 'acme', name: 'app' };

export function testJob(prompt: string): RunJob {
  return { repository: TEST_REPOSITORY, ref: 'main', prompt, permissionMode: 'plan' };
}

export interface TestRunnerOptions {
  plane: FakeControlPlane;
  gitBaseUrl: string;
  variables?: Record<string, string>;
}

/** A runner environment with its own data directory, the fake agent and a `file:` remote. */
export async function testRunnerEnv(options: TestRunnerOptions): Promise<RunnerEnv> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-data-'));
  const parsed = parseRunnerEnv({
    PLANGINEER_RUNNER_DATA_DIR: dataDir,
    PLANGINEER_CLAUDE_COMMAND: JSON.stringify(FAKE_CLAUDE_COMMAND),
    PLANGINEER_GIT_BASE_URL: options.gitBaseUrl,
    LOG_LEVEL: 'error',
    ...options.variables,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  await writeCredentials(runnerPaths(dataDir).credentials, {
    serverUrl: options.plane.serverUrl,
    runnerId: randomUUID(),
    token: options.plane.token,
  });
  return parsed.env;
}

export function removeDataDir(env: RunnerEnv): Promise<void> {
  return rm(env.PLANGINEER_RUNNER_DATA_DIR, { recursive: true, force: true, maxRetries: 5 });
}

/** Starts a runner in this process against the fake control plane. */
export async function startTestRunner(
  env: RunnerEnv,
  plane: FakeControlPlane,
  adapter?: AgentAdapter,
) {
  return startRunner({
    env,
    credentials: { serverUrl: plane.serverUrl, runnerId: randomUUID(), token: plane.token },
    adapter: adapter ?? createClaudeCodeAdapter(env.PLANGINEER_CLAUDE_COMMAND),
    logger: pino({ level: 'silent' }),
  });
}

/** An adapter that yields `events` and then succeeds, standing in for an agent's output. */
export function scriptedAdapter(events: RunnerRunEventBody[]): AgentAdapter {
  return {
    name: 'claude-code',
    detect: async () => ({
      name: 'claude-code',
      version: '2.1.284',
      available: true,
      minimumVersion: '2.1.284',
    }),
    async *run(_job, signal) {
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
      }
      yield {
        type: 'run.succeeded',
        resultText: 'done',
        truncated: false,
        costUsd: null,
        durationMs: 1,
        numTurns: 1,
      };
    },
  };
}

/** Waits for a `hang` run of the fake agent to report its pids, and returns them. */
export async function waitForFakePids(plane: FakeControlPlane, runId: string): Promise<number[]> {
  const hasPids = (message: RunnerToServerMessage) =>
    message.type === 'run.events' &&
    message.runId === runId &&
    fakeProcessIds(message.events.map((entry) => entry.event)) !== null;
  await plane.waitFor((message): message is RunnerToServerMessage => hasPids(message));
  const pids = fakeProcessIds(plane.events(runId).map((entry) => entry.event));
  if (pids === null) throw new Error(`Run ${runId} reported no fake agent pids`);
  return pids;
}

/** Narrows a received message to one type, for `waitFor`. */
export function isMessage<T extends RunnerToServerMessage['type']>(type: T) {
  return (message: RunnerToServerMessage): message is Extract<RunnerToServerMessage, { type: T }> =>
    message.type === type;
}

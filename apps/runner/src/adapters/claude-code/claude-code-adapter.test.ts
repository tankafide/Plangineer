import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isTerminalRunEvent, type RunnerRunEventBody } from '@plangineer/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_CLAUDE_COMMAND, fakeProcessIds, isProcessRunning } from '../../test/fake-agent.ts';
import { claudeArgs, createClaudeCodeAdapter } from './claude-code-adapter.ts';

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-code-adapter-'));
});

afterAll(() => rm(cwd, { recursive: true, force: true, maxRetries: 5 }));

async function collect(prompt: string, signal = new AbortController().signal) {
  const adapter = createClaudeCodeAdapter(FAKE_CLAUDE_COMMAND);
  const events: RunnerRunEventBody[] = [];
  for await (const event of adapter.run({ prompt, cwd, permissionMode: 'plan' }, signal)) {
    events.push(event);
  }
  return events;
}

describe('claudeArgs', () => {
  it('passes exactly the plan job arguments and never --bare', () => {
    const args = claudeArgs('plan');

    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'plan',
      '--permission-prompts',
      'none',
      '--tools',
      'Read,Glob,Grep,Skill',
      '--allowedTools',
      'Read,Glob,Grep,Skill',
      '--strict-mcp-config',
      '--settings',
      '{"disableAllHooks":true,"apiKeyHelper":"","awsAuthRefresh":"","awsCredentialExport":"","gcpAuthRefresh":"","otelHeadersHelper":""}',
    ]);
    expect(args).not.toContain('--bare');
  });
});

describe('detect', () => {
  it('reports the fake agent as available at its version', async () => {
    expect(await createClaudeCodeAdapter(FAKE_CLAUDE_COMMAND).detect()).toEqual({
      name: 'claude-code',
      version: '2.1.284',
      available: true,
      minimumVersion: '2.1.284',
    });
  });

  it('reports a version below 2.1.284 as unavailable', async () => {
    const command = [process.execPath, '-e', 'console.log("2.1.283 (Claude Code)")', '--'];

    expect(await createClaudeCodeAdapter(command).detect()).toMatchObject({
      version: '2.1.283',
      available: false,
    });
  });

  it('reports a missing command as unavailable with no version', async () => {
    const command = ['plangineer-no-such-claude-command'];

    expect(await createClaudeCodeAdapter(command).detect()).toMatchObject({
      version: null,
      available: false,
    });
  });
});

describe('run', () => {
  it('streams the success fixture to one run.succeeded', async () => {
    const events = await collect('List the files.');

    expect(events.filter(isTerminalRunEvent).map((event) => event.type)).toEqual(['run.succeeded']);
    expect(events).toHaveLength(13);
  });

  it('maps CRLF output exactly like LF output', async () => {
    const [lf, crlf] = await Promise.all([collect('fake:success'), collect('fake:crlf')]);

    expect(crlf).toEqual(lf);
  });

  it('ends an exit with no result in run.failed with reason exit_code and the stderr tail', async () => {
    const events = await collect('fake:crash');

    expect(events.filter(isTerminalRunEvent)).toEqual([
      {
        type: 'run.failed',
        reason: 'exit_code',
        message: 'Claude Code exited with code 2 before its result.',
        exitCode: 2,
        stderrTail: ['fatal: first', 'fatal: second', 'fatal: third'],
      },
    ]);
  });

  it('ends a line that is not JSON in run.failed with reason invalid_output', async () => {
    const events = await collect('fake:garbage');

    expect(events.map((event) => event.type)).toEqual(['agent.session', 'run.failed']);
    expect(events.at(-1)).toMatchObject({ reason: 'invalid_output' });
  });

  it('stops the child and its process group on abort and yields no terminal event', async () => {
    const controller = new AbortController();
    const adapter = createClaudeCodeAdapter(FAKE_CLAUDE_COMMAND);
    const events: RunnerRunEventBody[] = [];
    let pids: number[] | null = null;

    for await (const event of adapter.run(
      { prompt: 'fake:hang', cwd, permissionMode: 'plan' },
      controller.signal,
    )) {
      events.push(event);
      pids = fakeProcessIds(events);
      if (pids !== null) controller.abort();
    }

    expect(pids).not.toBeNull();
    expect(events.some(isTerminalRunEvent)).toBe(false);
    expect(pids?.map(isProcessRunning)).toEqual([false, false]);
  });
});

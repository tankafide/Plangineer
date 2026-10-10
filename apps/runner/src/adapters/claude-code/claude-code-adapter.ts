import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import {
  CLAUDE_CODE_MIN_VERSION,
  type CliStatus,
  type RunnerRunEventBody,
  STDERR_LINE_MAX,
  STDERR_TAIL_LINES,
} from '@plangineer/contracts';
import { execa } from 'execa';
import { stopProcess, trackProcess } from '../../process/stop-process.ts';
import type { AgentAccess, AgentAdapter, AgentJob } from '../agent-adapter.ts';
import { createClaudeMapping } from './claude-code-mapping.ts';
import { childEnv } from './child-env.ts';

const DETECT_TIMEOUT_MS = 30_000;
/**
 * The CLI flags for each access level. `dontAsk` denies anything the allow rules miss, and an
 * `Edit(...)` rule covers every file tool. Web fetches reach only GitHub, so injected text
 * cannot send repository code elsewhere.
 */
const ACCESS: Record<AgentAccess, { permissionMode: string; tools: string; allowedTools: string }> =
  {
    read_only: {
      permissionMode: 'plan',
      tools: 'Read,Glob,Grep,Skill',
      allowedTools: 'Read,Glob,Grep,Skill',
    },
    research: {
      permissionMode: 'dontAsk',
      tools: 'Read,Glob,Grep,Skill,WebSearch,WebFetch',
      allowedTools:
        'Read Glob Grep Skill WebSearch WebFetch(domain:github.com) WebFetch(domain:raw.githubusercontent.com)',
    },
    write_skills: {
      permissionMode: 'dontAsk',
      tools: 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch,Agent',
      allowedTools:
        'Read Glob Grep Edit(.agents/skills/**) WebSearch WebFetch(domain:github.com) WebFetch(domain:raw.githubusercontent.com) Agent',
    },
  };
/** Repository hooks and credential helpers never run; project skills still load. */
const SETTINGS = JSON.stringify({
  disableAllHooks: true,
  apiKeyHelper: '',
  awsAuthRefresh: '',
  awsCredentialExport: '',
  gcpAuthRefresh: '',
  otelHeadersHelper: '',
});

/** Claude Code's arguments for a job. Never `--bare`, which skips skills and the user's login. */
export function claudeArgs(access: AgentAccess): string[] {
  const { permissionMode, tools, allowedTools } = ACCESS[access];
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    permissionMode,
    '--permission-prompts',
    'none',
    '--tools',
    tools,
    '--allowedTools',
    allowedTools,
    '--strict-mcp-config',
    '--settings',
    SETTINGS,
  ];
}

function versionParts(version: string): number[] {
  return version.split('.').map(Number);
}

function isAtLeast(version: string, minimum: string): boolean {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  for (const [index, part] of required.entries()) {
    const own = actual[index] ?? 0;
    if (own !== part) return own > part;
  }
  return true;
}

/** Keeps the last stderr lines of a child, each cut to its bound. */
function collectStderrTail(stderr: Readable): { lines: string[]; done: Promise<void> } {
  const lines: string[] = [];
  const reader = createInterface({ input: stderr, crlfDelay: Infinity });
  reader.on('line', (line) => {
    lines.push(line.slice(0, STDERR_LINE_MAX));
    if (lines.length > STDERR_TAIL_LINES) lines.shift();
  });
  return { lines, done: new Promise((resolve) => reader.once('close', resolve)) };
}

export function createClaudeCodeAdapter(command: readonly string[]): AgentAdapter {
  const [executable, ...prefix] = command;
  if (executable === undefined) throw new Error('The Claude Code command is empty');
  const file: string = executable;
  const spawnOptions = { extendEnv: false, env: childEnv(process.env), reject: false } as const;

  async function detect(): Promise<CliStatus> {
    const status = { name: 'claude-code', minimumVersion: CLAUDE_CODE_MIN_VERSION } as const;
    const result = await execa(file, [...prefix, '--version'], {
      ...spawnOptions,
      timeout: DETECT_TIMEOUT_MS,
    });
    const version = result.failed ? undefined : /\d+\.\d+\.\d+/.exec(result.stdout)?.[0];
    if (version === undefined) return { ...status, version: null, available: false };
    return { ...status, version, available: isAtLeast(version, CLAUDE_CODE_MIN_VERSION) };
  }

  async function* run(job: AgentJob, signal: AbortSignal): AsyncGenerator<RunnerRunEventBody> {
    if (signal.aborted) return;
    const child = execa(file, [...prefix, ...claudeArgs(job.access)], {
      ...spawnOptions,
      input: job.prompt,
      cwd: job.cwd,
      buffer: false,
      detached: process.platform !== 'win32',
    });
    const running = trackProcess(child);
    let stopping: Promise<void> | undefined;
    const stop = () => (stopping ??= stopProcess(running));
    // The finally block awaits the same stop, so a failure surfaces there and not twice.
    const onAbort = () => void stop().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    const stderrTail = collectStderrTail(child.stderr);
    const mapping = createClaudeMapping();
    try {
      for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        if (signal.aborted) break;
        if (line.trim() === '') continue;
        const mapped = mapping.mapLine(line);
        if (!mapped.ok) {
          await stop();
          yield mapped.event;
          return;
        }
        yield* mapped.events;
      }
      const result = await child;
      await stderrTail.done;
      if (signal.aborted) return;
      yield mapping.finish(result.exitCode ?? null, stderrTail.lines);
    } finally {
      signal.removeEventListener('abort', onAbort);
      await stop();
      await running.exited;
    }
  }

  return { name: 'claude-code', detect, run };
}

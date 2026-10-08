/**
 * A stand-in for `claude` with the same command shape, for runner tests and `pnpm dev`. It replays
 * recorded stream-json fixtures and never calls a model. The first prompt line `fake:<scenario>`
 * picks the scenario, and `success` is the default.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../__fixtures__/claude-code/2.1.284/', import.meta.url);
const LINE_GAP_MS = 50;
const SLOW_LINE_GAP_MS = 500;

function fixture(name: string): string[] {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

function write(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

async function replay(lines: string[], gapMs: number, ending: string): Promise<void> {
  for (const line of lines) {
    await write(process.stdout, `${line}${ending}`);
    await delay(gapMs);
  }
}

async function exitAfter(
  lines: string[],
  exitCode: number,
  { gapMs = LINE_GAP_MS, ending = '\n' }: { gapMs?: number; ending?: string } = {},
): Promise<number> {
  await replay(lines, gapMs, ending);
  return exitCode;
}

async function crash(): Promise<number> {
  await replay(fixture('success-tools.jsonl').slice(0, 2), LINE_GAP_MS, '\n');
  await write(process.stderr, 'fatal: first\nfatal: second\nfatal: third\n');
  return 2;
}

/** Writes the init line and the pids of itself and a grandchild, then waits to be stopped. */
async function hang(): Promise<null> {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    stdio: 'ignore',
  });
  const [init = ''] = fixture('success-tools.jsonl');
  const pids = { type: 'fake_processes', pid: process.pid, grandchildPid: grandchild.pid };
  await replay([init, JSON.stringify(pids)], LINE_GAP_MS, '\n');
  setInterval(() => {}, 60_000);
  return null;
}

/** Each scenario resolves to its exit code, or null when it waits to be stopped. */
const scenarios: Record<string, () => Promise<number | null>> = {
  success: () => exitAfter(fixture('success-tools.jsonl'), 0),
  'agent-error': () => exitAfter(fixture('agent-error.jsonl'), 1),
  'rate-limit': () => exitAfter(fixture('synthetic-rate-limit-rejected.jsonl'), 1),
  crash,
  garbage: () => exitAfter([...fixture('success-tools.jsonl').slice(0, 1), 'not json'], 0),
  crlf: () => exitAfter(fixture('success-tools.jsonl'), 0, { ending: '\r\n' }),
  hang,
  slow: () => exitAfter(fixture('success-tools.jsonl'), 0, { gapMs: SLOW_LINE_GAP_MS }),
};

async function main(): Promise<void> {
  if (process.argv.includes('--version')) {
    await write(process.stdout, '2.1.284 (Claude Code)\n');
    return;
  }
  const prompt = await text(process.stdin);
  const scenarioName = /^fake:(\S+)/.exec(prompt)?.[1] ?? 'success';
  const scenario = scenarios[scenarioName];
  if (scenario === undefined) throw new Error(`Unknown fake scenario: ${scenarioName}`);
  const exitCode = await scenario();
  if (exitCode !== null) process.exitCode = exitCode;
}

await main();

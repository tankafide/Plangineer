/**
 * A stand-in for `claude` with the same command shape, for runner tests and `pnpm dev`. It replays
 * recorded stream-json fixtures and never calls a model. The first prompt line `fake:<scenario>`
 * picks the scenario, and `success` is the default.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/** The success fixture with an empty answer in its result line. */
function blankAnswer(): string[] {
  return fixture('success-tools.jsonl').map((line) => {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || !('type' in value)) return line;
    return value.type === 'result' ? JSON.stringify({ ...value, result: '' }) : line;
  });
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

const SKILLS = path.join('.agents', 'skills');
const SLOT_LINE = /^<!-- slot: .* -->$/;

/** Every SKILL.md under .agents/skills/ in the working directory. */
async function skillFiles(): Promise<string[]> {
  const entries = await readdir(SKILLS, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'SKILL.md')
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Replaces every slot line, as the setup agent does, and returns the files it filled. */
async function fillSlots(): Promise<string[]> {
  const filled: string[] = [];
  for (const file of await skillFiles()) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    if (!lines.some((line) => SLOT_LINE.test(line))) continue;
    const replaced = lines.map((line) =>
      SLOT_LINE.test(line) ? 'Filled by the fake agent.' : line,
    );
    await writeFile(file, replaced.join('\n'));
    filled.push(file);
  }
  return filled;
}

/** Writes the generated `backend` rule skill, under the given frontmatter name. */
async function writeBackend(name = 'backend'): Promise<void> {
  const folder = path.join(SKILLS, 'backend');
  await mkdir(path.join(folder, 'agents'), { recursive: true });
  const skill = `---\nname: ${name}\ndescription: Server rules.\ndisable-model-invocation: true\n---\n\n# Backend\n\nSee [project-stack](../project-stack/SKILL.md).\n`;
  await writeFile(path.join(folder, 'SKILL.md'), skill);
  await writeFile(
    path.join(folder, 'agents', 'openai.yaml'),
    'policy:\n  allow_implicit_invocation: false\n',
  );
}

/** Writes like the setup agent, then reports success. */
async function setup(change: () => Promise<void> = async () => {}): Promise<number> {
  await change();
  return exitAfter(fixture('success-tools.jsonl'), 0);
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
  blank: () => exitAfter(blankAnswer(), 0),
  slow: () => exitAfter(fixture('success-tools.jsonl'), 0, { gapMs: SLOW_LINE_GAP_MS }),
  'setup-skills': () =>
    setup(async () => {
      await fillSlots();
      await writeBackend();
    }),
  'setup-invalid-skill': () =>
    setup(async () => {
      await fillSlots();
      await writeBackend('back-end');
    }),
  'setup-edits-fixed-text': () =>
    setup(async () => {
      const [filled] = await fillSlots();
      if (filled !== undefined) {
        const content = await readFile(filled, 'utf8');
        await writeFile(filled, content.replace(/^# .*$/m, '# Retitled by the agent'));
      }
      await writeBackend();
    }),
  'setup-leaves-slot': () => setup(() => writeBackend()),
  'setup-edits-existing': () =>
    setup(async () => {
      await fillSlots();
      await writeBackend();
      await appendFile(path.join(SKILLS, 'alpha', 'SKILL.md'), 'Edited.\n');
    }),
  'setup-outside-path': () =>
    setup(async () => {
      await fillSlots();
      await writeBackend();
      await writeFile('notes.txt', 'Notes.\n');
    }),
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

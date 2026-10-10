/**
 * A stand-in for `claude -p` in the auto-run tests. It never calls a model. The first argument is
 * a JSON file holding `recordFile`, the path to record each call to, and `results`, which maps each
 * session key to a list of answers. The key comes from the prompt: `resume`, `plan-fix`,
 * `implementation-fix`, `plan-review`, `implementation-review`, `plan` or `implementation`. The nth
 * call with a key takes the nth answer, `{ event, writes, commit }`: `event` is the result event, a
 * raw line to print in its place, or null for none; `writes` maps paths relative to the working
 * directory, or under `$ADD_DIR/` for the `--add-dir` folder, to the text to write there, or to
 * null to delete the file; and `commit: true` then commits everything as `<key> <n>`. With
 * `leaveProcess`, it starts a detached process that outlives it and records its pid, then
 * waits `lingerMs` before it exits.
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';

/** The session a call stands for, from what its prompt holds. */
function sessionKey(prompt) {
  if (prompt.includes('You were cut off')) return 'resume';
  if (prompt.includes('.findings.json')) {
    return prompt.includes('plan-orchestrator') ? 'plan-fix' : 'implementation-fix';
  }
  if (prompt.includes('plan-review-orchestrator')) return 'plan-review';
  if (prompt.includes('implementation-review-orchestrator')) return 'implementation-review';
  if (prompt.includes('plan-orchestrator')) return 'plan';
  return 'implementation';
}

const git = (...args) =>
  execa('git', ['-c', 'user.name=fake', '-c', 'user.email=fake@example.com', ...args]);

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const prompt = await text(process.stdin);
const settingsFile = args[args.indexOf('--append-system-prompt-file') + 1];
const settings = await readFile(settingsFile, 'utf8');
const bgWaitCeiling = process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
const key = sessionKey(prompt);
const earlier = (await readFile(config.recordFile, 'utf8').catch(() => ''))
  .split('\n')
  .filter(Boolean)
  .filter((line) => JSON.parse(line).key === key).length;
const left = config.leaveProcess
  ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
  : undefined;
left?.unref();
const call = { key, args, prompt, settings, bgWaitCeiling, leftPid: left?.pid };
await appendFile(config.recordFile, `${JSON.stringify(call)}\n`);

const answer = config.results[key]?.[earlier];
if (answer === undefined) throw new Error(`No answer for call ${earlier + 1} with key ${key}`);
const addDir = args[args.indexOf('--add-dir') + 1];
for (const [written, contents] of Object.entries(answer.writes ?? {})) {
  const file = written.startsWith('$ADD_DIR/')
    ? path.join(addDir, written.slice('$ADD_DIR/'.length))
    : written;
  if (contents === null) {
    await rm(file);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}
if (answer.commit) {
  await git('add', '--all');
  await git('commit', '--quiet', '--allow-empty', '-m', `${key} ${earlier + 1}`);
}

const resumed = args.indexOf('--resume');
const sessionId = resumed === -1 ? `${key}-session` : args[resumed + 1];
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId }));
if (typeof answer.event === 'string') console.log(answer.event);
else if (answer.event !== null) console.log(JSON.stringify(answer.event));
if (left !== undefined) await delay(config.lingerMs);

/**
 * A stand-in for `claude -p` in the auto-run tests. It never calls a model. The first argument is
 * a JSON file holding, for each session (`plan`, `implementation`, or `resume` for a call with
 * `--resume`), its result event, a raw line to print in its place, or null for none, and a path to
 * record each call to. With `leaveProcess`, it starts a detached process that outlives it and
 * records its pid, then waits `lingerMs` before it exits.
 */
import { spawn } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const prompt = await text(process.stdin);
const settingsFile = args[args.indexOf('--append-system-prompt-file') + 1];
const settings = await readFile(settingsFile, 'utf8');
const bgWaitCeiling = process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
const left = config.leaveProcess
  ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
  : undefined;
left?.unref();
const call = { args, prompt, settings, bgWaitCeiling, leftPid: left?.pid };
await appendFile(config.recordFile, `${JSON.stringify(call)}\n`);

const session = args.includes('--resume')
  ? 'resume'
  : prompt.includes('plan-orchestrator')
    ? 'plan'
    : 'implementation';
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: `${session}-session` }));
const result = config.results[session];
if (typeof result === 'string') console.log(result);
else if (result !== null) console.log(JSON.stringify(result));
if (left !== undefined) await delay(config.lingerMs);

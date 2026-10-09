/**
 * A stand-in for `claude -p` in the auto-run tests. It never calls a model. The first argument is
 * a JSON file holding, for each session, its result event, a raw line to print in its place, or
 * null for none, and a path to record each call to.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const prompt = await text(process.stdin);
const settingsFile = args[args.indexOf('--append-system-prompt-file') + 1];
const settings = await readFile(settingsFile, 'utf8');
await appendFile(config.recordFile, `${JSON.stringify({ args, prompt, settings })}\n`);

const session = prompt.includes('plan-orchestrator') ? 'plan' : 'implementation';
console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
const result = config.results[session];
if (typeof result === 'string') console.log(result);
else if (result !== null) console.log(JSON.stringify(result));

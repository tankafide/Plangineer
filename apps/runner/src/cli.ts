#!/usr/bin/env node
import os from 'node:os';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { CommandResult } from './command-result.ts';
import { parseRunnerEnv, type RunnerEnv } from './config/runner-env.ts';
import { packageVersion } from './package-version.ts';
import open from 'open';
import { loginCommand } from './login-command.ts';
import { lintSkills } from './skills/skill-lint.ts';
import { checkSkills, syncSkills } from './skills/skills-mirror.ts';
import { startCommand } from './start-command.ts';

const USAGE = [
  'Usage: plangineer-runner <command>',
  '  login --server <url> [--name <name>] [--no-browser] [--json]',
  '  start [--server <url>]',
  '  skills sync',
  '  skills check [--staged]',
  '  skills lint',
  '  --version',
].join('\n');

const usage = (): CommandResult => ({ exitCode: 1, message: USAGE });

/** Runs `command` with the parsed environment, or fails naming each invalid variable. */
async function withEnv(
  command: (env: RunnerEnv) => Promise<CommandResult>,
): Promise<CommandResult> {
  const parsed = parseRunnerEnv(process.env);
  return parsed.ok ? command(parsed.env) : { exitCode: 1, message: parsed.message };
}

/** The command's flags, or null when an argument is unknown, misplaced or missing its value. */
function parseFlags<T extends ParseArgsOptionsConfig>(args: string[], options: T) {
  try {
    return parseArgs({ args, options }).values;
  } catch (error) {
    if (error instanceof TypeError && 'code' in error) return null;
    throw error;
  }
}

async function login(args: string[]): Promise<CommandResult> {
  const values = parseFlags(args, {
    server: { type: 'string' },
    name: { type: 'string' },
    'no-browser': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (values?.server === undefined || !URL.canParse(values.server)) return usage();
  const options = {
    serverUrl: values.server,
    name: values.name ?? os.hostname(),
    openBrowser: values['no-browser'] !== true,
    json: values.json === true,
  };
  return withEnv((env) => loginCommand(env, options, open));
}

async function start(args: string[]): Promise<CommandResult> {
  const values = parseFlags(args, { server: { type: 'string' } });
  if (values === null) return usage();
  const serverUrl = values.server ?? null;
  if (serverUrl !== null && !URL.canParse(serverUrl)) return usage();
  return withEnv((env) => startCommand(env, { serverUrl }));
}

async function runCommand(args: string[]): Promise<CommandResult> {
  const [command, ...rest] = args;
  const cwd = process.cwd();
  const restIs = (...expected: string[]) =>
    rest.length === expected.length && expected.every((arg, index) => rest[index] === arg);
  if (command === '--version' && restIs()) return { exitCode: 0, message: packageVersion() };
  if (command === 'skills' && restIs('sync')) return syncSkills(cwd);
  if (command === 'skills' && restIs('lint')) return lintSkills(cwd);
  if (command === 'skills' && restIs('check')) return checkSkills(cwd, { staged: false });
  if (command === 'skills' && restIs('check', '--staged')) {
    return checkSkills(cwd, { staged: true });
  }
  if (command === 'login') return login(rest);
  if (command === 'start') return start(rest);
  return usage();
}

const result = await runCommand(process.argv.slice(2));
if (result.message !== null) {
  if (result.exitCode === 0) console.log(result.message);
  else console.error(result.message);
}
process.exitCode = result.exitCode;

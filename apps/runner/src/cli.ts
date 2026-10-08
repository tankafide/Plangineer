#!/usr/bin/env node
import os from 'node:os';
import { parseArgs } from 'node:util';
import type { CommandResult } from './command-result.ts';
import { parseRunnerEnv, type RunnerEnv } from './config/runner-env.ts';
import { packageVersion } from './package-version.ts';
import { pairCommand } from './pair-command.ts';
import { lintSkills } from './skills/skill-lint.ts';
import { checkSkills, syncSkills } from './skills/skills-mirror.ts';
import { startCommand } from './start-command.ts';

const USAGE = [
  'Usage: plangineer-runner <command>',
  '  pair --server <url> --code <code> [--name <name>]',
  '  start',
  '  skills sync',
  '  skills check [--staged]',
  '  skills lint',
  '  --version',
].join('\n');

const usage = (): CommandResult => ({ ok: false, message: USAGE });

/** Runs `command` with the parsed environment, or fails naming each invalid variable. */
async function withEnv(
  command: (env: RunnerEnv) => Promise<CommandResult>,
): Promise<CommandResult> {
  const parsed = parseRunnerEnv(process.env);
  return parsed.ok ? command(parsed.env) : { ok: false, message: parsed.message };
}

function parsePairArgs(args: string[]) {
  try {
    return parseArgs({
      args,
      options: { server: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' } },
    }).values;
  } catch (error) {
    if (error instanceof TypeError && 'code' in error) return null;
    throw error;
  }
}

async function pair(args: string[]): Promise<CommandResult> {
  const values = parsePairArgs(args);
  if (values?.server === undefined || values.code === undefined) return usage();
  if (!URL.canParse(values.server)) return usage();
  const options = {
    serverUrl: values.server,
    code: values.code,
    name: values.name ?? os.hostname(),
  };
  return withEnv((env) => pairCommand(env, options));
}

async function runCommand(args: string[]): Promise<CommandResult> {
  const [command, ...rest] = args;
  const cwd = process.cwd();
  const restIs = (...expected: string[]) =>
    rest.length === expected.length && expected.every((arg, index) => rest[index] === arg);
  if (command === '--version' && restIs()) return { ok: true, message: packageVersion() };
  if (command === 'skills' && restIs('sync')) return syncSkills(cwd);
  if (command === 'skills' && restIs('lint')) return lintSkills(cwd);
  if (command === 'skills' && restIs('check')) return checkSkills(cwd, { staged: false });
  if (command === 'skills' && restIs('check', '--staged')) {
    return checkSkills(cwd, { staged: true });
  }
  if (command === 'pair') return pair(rest);
  if (command === 'start' && restIs()) return withEnv(startCommand);
  return usage();
}

const result = await runCommand(process.argv.slice(2));
if (result.ok) console.log(result.message);
else {
  console.error(result.message);
  process.exitCode = 1;
}

import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlanReport, runSession } from './auto-run-session.mjs';
import { repoRoot } from './script-entry.mjs';

const FAKE_CLAUDE = path.join(repoRoot, 'scripts/auto-run-fake-claude.mjs');

const planReport = {
  outcome: 'done',
  branch: 'feat/thing',
  commits: ['abc1234 Plan the thing'],
  reviewRounds: ['Round 1: 2 fixed, 0 skipped, 1 dropped'],
  decisions: [],
  engineerActions: [],
  planPath: 'docs/plans/2026-10-08-thing.md',
};

const success = (report) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output: { report },
});

describe('runSession', () => {
  let root;
  let recordFile;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-run-session-')));
    recordFile = path.join(root, 'calls.jsonl');
    await writeFile(path.join(root, 'settings.md'), 'Workflow settings:\n{}\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function session(plan, command) {
    const configFile = path.join(root, 'config.json');
    await writeFile(configFile, JSON.stringify({ recordFile, results: { plan } }));
    return runSession({
      command: command ?? [process.execPath, FAKE_CLAUDE, configFile],
      cwd: root,
      prompt: 'Use the plan-orchestrator skill.',
      settingsFile: path.join(root, 'settings.md'),
      schema: PlanReport,
      logFile: path.join(root, 'plan.jsonl'),
    });
  }

  async function firstCall() {
    const [firstLine] = (await readFile(recordFile, 'utf8')).split('\n');
    return JSON.parse(firstLine);
  }

  async function args() {
    return (await firstCall()).args;
  }

  it('returns the validated report', async () => {
    expect(await session(success(planReport))).toEqual(planReport);
  });

  it('runs headless and unattended, and blocks pushing and merging', async () => {
    await session(success(planReport));

    expect((await args()).slice(0, 11)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'auto',
      '--permission-prompts',
      'none',
      '--disallowedTools',
      'Bash(git push:*)',
      'Bash(gh:*)',
    ]);
  });

  it('waits for every background subagent, with no time limit', async () => {
    await session(success(planReport));

    expect((await firstCall()).bgWaitCeiling).toBe('0');
  });

  it('passes a draft-07 schema with the report union nested under one key', async () => {
    await session(success(planReport));

    const passed = await args();
    const schema = JSON.parse(passed[passed.indexOf('--json-schema') + 1]);
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.required).toEqual(['report']);
    const [finished, halted] = schema.properties.report.oneOf;
    expect(finished.required).toEqual(expect.arrayContaining(['engineerActions', 'planPath']));
    expect(halted.required).toContain('stopReason');
  });

  it.each([
    ['a report missing a field', { ...planReport, engineerActions: undefined }, 'engineerActions'],
    ['a finished report with no plan', { ...planReport, planPath: null }, 'planPath'],
    [
      'a stopped report with no reason',
      { ...planReport, outcome: 'stopped', stopReason: '' },
      'stopReason',
    ],
  ])('rejects %s', async (_, report, field) => {
    const failure = session(success(report));
    await expect(failure).rejects.toThrow(/^The session's report does not match its schema\. See /);
    await expect(failure).rejects.toHaveProperty('cause.issues.0.path', ['report', field]);
  });

  it.each([
    [
      'ends in an error',
      { type: 'result', subtype: 'error_max_turns', is_error: true },
      /^The session failed with error_max_turns\. See /,
    ],
    [
      'fails after starting',
      { type: 'result', subtype: 'success', is_error: true, result: 'Not signed in' },
      /^The session failed with success: Not signed in\. See /,
    ],
    [
      'ends with a result event of an unexpected shape',
      { type: 'result', subtype: 'success' },
      /^The session's result event has an unexpected shape\. See /,
    ],
    ['writes an event with no type', '42', /^The session wrote an event with no type\. See /],
    [
      'writes a line that is not JSON',
      'not json',
      /^The session wrote a line that is not JSON\. See .*plan\.jsonl$/,
    ],
    ['ends with no result', null, /^The session ended with no result \(exit code 0\)\. See /],
  ])('fails a session that %s, naming its log', async (_, plan, message) => {
    await expect(session(plan)).rejects.toThrow(message);
  });

  it('names the failure when the CLI cannot start', async () => {
    await expect(session(null, [path.join(root, 'no-such-claude')])).rejects.toThrow(
      /^The session ended with no result \(.+\)\. See /,
    );
  });
});

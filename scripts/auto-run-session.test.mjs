import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanReport, ReviewReport, runSession, sessionIdOf } from './auto-run-session.mjs';
import { repoRoot } from './script-entry.mjs';

const FAKE_CLAUDE = path.join(repoRoot, 'scripts/auto-run-fake-claude.mjs');

const planReport = {
  outcome: 'done',
  branch: 'feat/thing',
  commits: ['abc1234 Plan the thing'],
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

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runSession', () => {
  let root;
  let recordFile;
  let logFile;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-run-session-')));
    recordFile = path.join(root, 'calls.jsonl');
    logFile = path.join(root, 'plan.jsonl');
    await writeFile(path.join(root, 'settings.md'), 'Workflow settings:\n{}\n');
  });

  afterEach(async () => {
    const calls = await readFile(recordFile, 'utf8').catch(() => '');
    for (const line of calls.split('\n').filter(Boolean)) {
      const { leftPid } = JSON.parse(line);
      if (leftPid !== undefined && isRunning(leftPid)) process.kill(leftPid);
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function session(plan, { command, config, ...options } = {}) {
    const configFile = path.join(root, 'config.json');
    const results = { plan: [{ event: plan }] };
    await writeFile(configFile, JSON.stringify({ recordFile, results, ...config }));
    return runSession({
      command: command ?? [process.execPath, FAKE_CLAUDE, configFile],
      cwd: root,
      prompt: 'Use the plan-orchestrator skill.',
      settingsFile: path.join(root, 'settings.md'),
      schema: PlanReport,
      logFile,
      ...options,
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
    await expect(session(null, { command: [path.join(root, 'no-such-claude')] })).rejects.toThrow(
      /^The session ended with no result \(.+\)\. See /,
    );
  });

  it('continues a session with --resume and appends to its log', async () => {
    const earlier = [
      { type: 'system', subtype: 'init', session_id: 'plan-session' },
      { type: 'result', subtype: 'error_max_turns', is_error: true },
    ];
    await writeFile(logFile, earlier.map((event) => `${JSON.stringify(event)}\n`).join(''));

    const report = await session(success(planReport), { resumeId: 'plan-session' });

    expect(report).toEqual(planReport);
    expect((await args()).slice(0, 3)).toEqual(['-p', '--resume', 'plan-session']);
    const log = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean);
    expect(log.map((line) => JSON.parse(line).type)).toEqual([
      'system',
      'result',
      'system',
      'result',
    ]);
  });

  it('drops a line a killed session cut short before resuming it', async () => {
    await writeFile(logFile, `${init('plan-session')}\n{"type":"assis`);

    expect(await sessionIdOf(logFile)).toBe('plan-session');
    await session(success(planReport), { resumeId: 'plan-session' });
    const log = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean);
    expect(log.map((line) => JSON.parse(line).type)).toEqual(['system', 'system', 'result']);
  });

  it('reads only what a resumed session wrote, not the earlier result', async () => {
    await writeFile(logFile, `${JSON.stringify(success(planReport))}\n`);

    await expect(session(null, { resumeId: 'plan-session' })).rejects.toThrow(
      /^The session ended with no result \(exit code 0\)\. See /,
    );
  });

  it('lets the session read a folder outside its working directory', async () => {
    const findingsDir = path.join(root, 'findings');

    await session(success(planReport), { addDir: findingsDir });

    const passed = await args();
    expect(passed[passed.indexOf('--add-dir') + 1]).toBe(findingsDir);
  });

  it('passes no extra folder when none is given', async () => {
    await session(success(planReport));

    expect(await args()).not.toContain('--add-dir');
  });

  it('stops a process the session left running', async () => {
    await session(success(planReport), {
      config: { leaveProcess: true, lingerMs: 1_500 },
      processPollMs: 100,
    });

    const { leftPid } = await firstCall();
    await vi.waitFor(() => expect(isRunning(leftPid)).toBe(false), { timeout: 5_000 });
  });
});

const init = (id) => JSON.stringify({ type: 'system', subtype: 'init', session_id: id });

describe('sessionIdOf', () => {
  let root;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-run-session-id-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("returns the id of the log's last session", async () => {
    const logFile = path.join(root, 'implementation.jsonl');
    await writeFile(logFile, `${init('first')}\n{"type":"result"}\n${init('second')}\n`);

    expect(await sessionIdOf(logFile)).toBe('second');
  });

  it('refuses a log with no session', async () => {
    const logFile = path.join(root, 'plan.jsonl');
    await writeFile(logFile, '{"type":"result"}\n');

    await expect(sessionIdOf(logFile)).rejects.toThrow(`${logFile} holds no session to resume`);
  });
});

const finding = (overrides = {}) => ({
  location: 'scripts/auto-run.mjs:12',
  claim: 'The run never stops.',
  suggestedChange: 'Stop after the last round.',
  sourceSkill: 'code-quality',
  kind: 'defect',
  severity: 'should fix',
  ...overrides,
});

describe('ReviewReport', () => {
  it('accepts a finding with every field and a plan audit', () => {
    const report = { outcome: 'done', findings: [finding()], planAudit: '| Step | Built |' };

    expect(ReviewReport.parse(report)).toEqual(report);
  });

  it.each(['minor', 'Blocker', ''])('rejects a finding with severity %j', (severity) => {
    const report = { outcome: 'done', findings: [finding({ severity })], planAudit: null };

    expect(ReviewReport.safeParse(report).error?.issues[0]?.path).toEqual([
      'findings',
      0,
      'severity',
    ]);
  });
});

describe('PlanReport', () => {
  it('rejects a report that still holds reviewRounds', () => {
    const result = PlanReport.safeParse({ ...planReport, reviewRounds: [] });

    expect(result.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['reviewRounds'],
    });
  });
});

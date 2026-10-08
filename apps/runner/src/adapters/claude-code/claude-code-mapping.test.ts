import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isTerminalRunEvent,
  RunnerRunEventBody,
  SKILL_NAME_MAX,
  SKILLS_MAX,
} from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeMapping } from './claude-code-mapping.ts';

function fixtureLines(name: string): string[] {
  const url = new URL(`../__fixtures__/claude-code/2.1.284/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

/** Maps every line, then finishes with the exit code, as the adapter does. */
function mapRun(lines: string[], exitCode: number | null, stderrTail: string[] = []) {
  const mapping = createClaudeMapping();
  const events: RunnerRunEventBody[] = [];
  for (const line of lines) {
    const mapped = mapping.mapLine(line);
    if (!mapped.ok) return [...events, mapped.event];
    events.push(...mapped.events);
  }
  return [...events, mapping.finish(exitCode, stderrTail)];
}

function initLine(overrides: Record<string, unknown>): string {
  const [init = ''] = fixtureLines('success-tools.jsonl');
  return JSON.stringify({ ...JSON.parse(init), ...overrides });
}

describe('createClaudeMapping', () => {
  it('maps the recorded successful run to its events and one run.succeeded', () => {
    const events = mapRun(fixtureLines('success-tools.jsonl'), 0);

    expect(events.map((event) => event.type)).toEqual([
      'agent.session',
      'agent.other',
      'agent.other',
      'agent.other',
      'agent.tool_use',
      'agent.rate_limit',
      'agent.other',
      'agent.tool_result',
      'agent.message',
      'agent.rate_limit',
      'agent.other',
      'agent.other',
      'run.succeeded',
    ]);
    expect(events[0]).toMatchObject({
      type: 'agent.session',
      model: 'claude-opus-5-5[1m]',
      cliVersion: '2.1.284',
    });
    expect(events[1]).toMatchObject({ vendorType: 'system/thinking_tokens', truncated: false });
    expect(events[3]).toMatchObject({ vendorType: 'assistant/thinking' });
    expect(events[4]).toEqual({
      type: 'agent.tool_use',
      toolUseId: 'toolu_01VRKnAzVx3XNGj3Jw2Q72QA',
      name: 'Glob',
      inputJson: '{"pattern":"*"}',
      truncated: false,
      parentToolUseId: null,
    });
    expect(events[5]).toEqual({
      type: 'agent.rate_limit',
      status: 'allowed',
      resetsAt: '2026-10-08T04:30:00.000Z',
    });
    expect(events[7]).toEqual({
      type: 'agent.tool_result',
      toolUseId: 'toolu_01VRKnAzVx3XNGj3Jw2Q72QA',
      isError: false,
      text: 'index.js\nnotes.txt\nREADME.md',
      truncated: false,
    });
    expect(events[8]).toMatchObject({ type: 'agent.message', parentToolUseId: null });
    expect(events.at(-1)).toMatchObject({
      type: 'run.succeeded',
      costUsd: 0.094256,
      durationMs: 4926,
      numTurns: 2,
      truncated: false,
    });
  });

  it('maps the recorded invalid-model run to run.failed with reason agent_error', () => {
    const events = mapRun(fixtureLines('agent-error.jsonl'), 1, ['model not found']);

    expect(events.map((event) => event.type)).toEqual([
      'agent.session',
      'agent.message',
      'run.failed',
    ]);
    expect(events.at(-1)).toEqual({
      type: 'run.failed',
      reason: 'agent_error',
      message:
        "There's an issue with the selected model (not-a-model). It may not exist or you may not have access to it. Run --model to pick a different model.",
      exitCode: 1,
      stderrTail: ['model not found'],
    });
  });

  it('maps a rejected rate limit followed by an error result to reason plan_limit', () => {
    const events = mapRun(fixtureLines('synthetic-rate-limit-rejected.jsonl'), 1);

    expect(events[1]).toEqual({
      type: 'agent.rate_limit',
      status: 'rejected',
      resetsAt: '2100-01-01T00:00:00.000Z',
    });
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', reason: 'plan_limit', exitCode: 1 });
  });

  it('maps an unmapped line type to agent.other with its type and the line as JSON', () => {
    const line = '{"type":"stream_event","subtype":"delta","value":1}';

    expect(createClaudeMapping().mapLine(line)).toEqual({
      ok: true,
      events: [
        { type: 'agent.other', vendorType: 'stream_event/delta', json: line, truncated: false },
      ],
    });
  });

  it('fails the run with reason invalid_output on a line that is not JSON', () => {
    const [first = ''] = fixtureLines('success-tools.jsonl');

    const events = mapRun([first, 'not json'], 0);

    expect(events.map((event) => event.type)).toEqual(['agent.session', 'run.failed']);
    expect(events.at(-1)).toMatchObject({ reason: 'invalid_output', exitCode: null });
  });

  it('fails the run with reason invalid_output on a known line of the wrong shape', () => {
    const mapped = createClaudeMapping().mapLine('{"type":"result","is_error":"no"}');

    expect(mapped).toMatchObject({ ok: false, event: { reason: 'invalid_output' } });
  });

  it('fails the run with reason exit_code and the stderr tail on an exit with no result', () => {
    const lines = fixtureLines('success-tools.jsonl').slice(0, 2);

    const events = mapRun(lines, 2, ['fatal: first']);

    expect(events.filter(isTerminalRunEvent)).toEqual([
      {
        type: 'run.failed',
        reason: 'exit_code',
        message: 'Claude Code exited with code 2 before its result.',
        exitCode: 2,
        stderrTail: ['fatal: first'],
      },
    ]);
  });

  it('fails a successful result with reason exit_code when the exit code is not 0', () => {
    expect(mapRun(fixtureLines('success-tools.jsonl'), 3).at(-1)).toMatchObject({
      type: 'run.failed',
      reason: 'exit_code',
      exitCode: 3,
    });
  });

  it('truncates 600 skills and a 70,000-character message to their bounds', () => {
    const skills = Array.from({ length: 600 }, (_, index) => `${'s'.repeat(150)}${index}`);
    const mapping = createClaudeMapping();

    const session = mapping.mapLine(initLine({ skills }));
    const message = mapping.mapLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a'.repeat(70_000) }] },
        parent_tool_use_id: 'toolu_parent',
      }),
    );

    if (!session.ok || !message.ok) throw new Error('expected both lines to map');
    const [sessionEvent] = session.events;
    const [messageEvent] = message.events;
    expect(sessionEvent).toMatchObject({ type: 'agent.session' });
    if (sessionEvent?.type !== 'agent.session') throw new Error('expected agent.session');
    expect(sessionEvent.skills).toHaveLength(SKILLS_MAX);
    expect(sessionEvent.skills.every((skill) => skill.length === SKILL_NAME_MAX)).toBe(true);
    expect(messageEvent).toMatchObject({
      type: 'agent.message',
      truncated: true,
      parentToolUseId: 'toolu_parent',
    });
    if (messageEvent?.type !== 'agent.message') throw new Error('expected agent.message');
    expect(messageEvent.text).toHaveLength(65_536);
    expect(RunnerRunEventBody.safeParse(sessionEvent).success).toBe(true);
    expect(RunnerRunEventBody.safeParse(messageEvent).success).toBe(true);
  });

  it('cuts text before a surrogate pair rather than through it', () => {
    const text = `${'a'.repeat(65_535)}😀`;
    const mapped = createClaudeMapping().mapLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
      }),
    );

    expect(mapped).toMatchObject({
      ok: true,
      events: [{ text: 'a'.repeat(65_535), truncated: true }],
    });
  });
});

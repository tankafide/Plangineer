import type { DraftStep, PlanningOutput, RunEvent } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { COMMIT, messageEvent, runEvent, RUNNER_ID } from '@/test/fixtures';
import { RunEventList } from './run-event-list';

const EVERY_KIND: RunEvent[] = [
  runEvent(1, { type: 'run.queued' }),
  runEvent(2, { type: 'run.leased', runnerId: RUNNER_ID, attempt: 1 }),
  runEvent(3, {
    type: 'run.started',
    commit: COMMIT,
    cli: { name: 'claude-code', version: '2.1.290' },
  }),
  runEvent(4, {
    type: 'agent.session',
    model: 'claude-opus',
    cliVersion: '2.1.290',
    skills: ['planning', 'testing'],
  }),
  runEvent(5, {
    type: 'agent.message',
    text: 'Looking around.',
    truncated: true,
    parentToolUseId: null,
  }),
  runEvent(6, {
    type: 'agent.tool_use',
    toolUseId: 'tool-1',
    name: 'Glob',
    inputJson: '{"pattern":"*"}',
    truncated: false,
    parentToolUseId: null,
  }),
  runEvent(7, {
    type: 'agent.tool_result',
    toolUseId: 'tool-1',
    isError: true,
    text: 'No such file',
    truncated: false,
  }),
  runEvent(8, { type: 'agent.rate_limit', status: 'allowed_warning', resetsAt: null }),
  runEvent(9, { type: 'agent.other', vendorType: 'system/status', json: '{}', truncated: false }),
  runEvent(10, { type: 'run.cancel_requested' }),
  runEvent(11, { type: 'run.lease_lost', attempt: 1, requeued: true }),
  runEvent(12, {
    type: 'run.failed',
    reason: 'timeout',
    message: 'Timed out.',
    exitCode: null,
    stderrTail: [],
  }),
  runEvent(13, { type: 'run.cancelled', reason: 'runner_revoked' }),
  runEvent(14, {
    type: 'setup.pushed',
    branch: 'plangineer/setup',
    commit: COMMIT,
    changedPaths: ['.agents/skills/testing/SKILL.md'],
    changedPathCount: 12,
  }),
];

function failedEvent(
  id: number,
  reason: 'setup_invalid_output' | 'setup_publish_failed' | 'inputs_failed',
) {
  return runEvent(id, {
    type: 'run.failed',
    reason,
    message: 'Failed.',
    exitCode: null,
    stderrTail: [],
  });
}

const DRAFT_STEP: DraftStep = {
  id: 'new-1',
  title: 'Export the CSV',
  files: ['src/export.ts'],
  body: '',
  doneWhen: [],
};

const PLANNING_OUTPUTS: [string, PlanningOutput][] = [
  [
    'Questions',
    {
      kind: 'questions',
      questions: [
        {
          section: 'goal',
          prompt: 'Which invoices?',
          choices: [
            { label: 'Paid', detail: '' },
            { label: 'All', detail: '' },
          ],
          recommended: 0,
        },
      ],
      decisions: [],
    },
  ],
  [
    'Plan draft',
    {
      kind: 'plan',
      plan: {
        goal: 'Export invoices.',
        prerequisites: [],
        steps: [DRAFT_STEP],
        decisions: [],
        constraints: [],
        coverage: [],
        blockers: [],
        verification: { automated: [], agentChecks: [], humanChecks: [] },
      },
    },
  ],
  ['Section', { kind: 'section', patch: { section: 'goal', goal: 'Export invoices.' } }],
  ['Step', { kind: 'step', step: DRAFT_STEP }],
];

function renderEvents(events: readonly RunEvent[]) {
  return renderPage(() => <RunEventList events={events} />);
}

describe('RunEventList', () => {
  it('shows No events yet before any event', async () => {
    await renderEvents([]);

    expect(await screen.findByText('No events yet')).toBeTruthy();
  });

  it('shows each event kind as one row', async () => {
    await renderEvents(EVERY_KIND);

    const list = within(await screen.findByRole('list', { name: 'Run events' }));
    expect(list.getAllByRole('listitem')).toHaveLength(EVERY_KIND.length);
    expect(list.getByText('Queued')).toBeTruthy();
    expect(list.getByText('Picked up by the runner, attempt 1')).toBeTruthy();
    expect(list.getByText(/Started at/).textContent).toContain(COMMIT.slice(0, 12));
    expect(list.getByText('Session on claude-opus, Claude Code 2.1.290, 2 skills')).toBeTruthy();
    expect(list.getByText('Looking around.')).toBeTruthy();
    expect(list.getByText('Truncated: the full text was too long to keep.')).toBeTruthy();
    expect(list.getByText('Glob')).toBeTruthy();
    expect(list.getByText('Tool error')).toBeTruthy();
    expect(list.getByText('No such file')).toBeTruthy();
    expect(list.getByText('Close to the Claude plan limit')).toBeTruthy();
    expect(list.getByText('system/status')).toBeTruthy();
    expect(list.getByText('Cancel requested')).toBeTruthy();
    expect(list.getByText('The runner lost attempt 1, so the run was queued again')).toBeTruthy();
    expect(list.getByText('Failed: The run took too long')).toBeTruthy();
    expect(list.getByText('Cancelled because its runner was revoked')).toBeTruthy();
    expect(list.getByText('Pushed plangineer/setup at 0123456, 12 files')).toBeTruthy();
  });

  it.each([
    ['setup_invalid_output', 'Failed: The setup output broke a skill rule'],
    ['setup_publish_failed', 'Failed: The setup branch could not be pushed'],
    ['inputs_failed', 'Failed: The planning inputs could not be downloaded'],
  ] as const)('labels the %s failure reason', async (reason, label) => {
    await renderEvents([failedEvent(1, reason)]);

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it.each(PLANNING_OUTPUTS)(
    'shows a planning output of kind %s as a Plan output row',
    async (label, output) => {
      await renderEvents([runEvent(1, { type: 'planning.output', output })]);

      const list = within(await screen.findByRole('list', { name: 'Run events' }));
      expect(list.getByRole('listitem').textContent).toBe(`Plan output: ${label}`);
    },
  );

  it('expands a tool use input with Show input', async () => {
    await renderEvents(EVERY_KIND);

    await userEvent.click(await screen.findByRole('button', { name: 'Show input' }));

    expect(screen.getByText('{"pattern":"*"}')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide input' })).toBeTruthy();
  });

  it('renders the latest 200 of 450 events, and 200 more on each Show earlier events', async () => {
    await renderEvents(Array.from({ length: 450 }, (_, index) => messageEvent(index + 1)));

    const list = within(await screen.findByRole('list', { name: 'Run events' }));
    expect(list.getAllByRole('listitem')).toHaveLength(200);
    expect(list.getByText('Message 251')).toBeTruthy();
    expect(list.queryByText('Message 250')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show earlier events' }));
    expect(list.getAllByRole('listitem')).toHaveLength(400);

    await userEvent.click(screen.getByRole('button', { name: 'Show earlier events' }));
    expect(list.getAllByRole('listitem')).toHaveLength(450);
    expect(list.getByText('Message 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show earlier events' })).toBeNull();
  });
});

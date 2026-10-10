import type {
  ContextFile,
  FeatureDetail,
  RepositoryDetail,
  Run,
  RunEvent,
  Runner,
} from '@plangineer/contracts';

export const RUNNER_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
export const RUN_ID = '0199c1a3-1111-7d4e-8f90-a1b2c3d4e5f6';
export const COMMIT = 'a'.repeat(40);

export function runnerFixture(overrides: Partial<Runner> = {}): Runner {
  return {
    id: RUNNER_ID,
    name: 'ada-laptop',
    platform: 'linux',
    status: 'active',
    online: true,
    lastSeenAt: '2026-10-07T10:00:00.000Z',
    planLimitResetsAt: null,
    concurrencyLimit: 2,
    clis: [{ name: 'claude-code', version: '2.1.284', available: true, minimumVersion: '2.1.284' }],
    createdAt: '2026-10-07T09:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

export function runFixture(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    kind: 'test',
    status: 'queued',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    attempt: 0,
    cancelRequested: false,
    createdAt: '2026-10-07T10:00:00.000Z',
    startedAt: null,
    endedAt: null,
    commit: null,
    runner: {
      id: RUNNER_ID,
      name: 'ada-laptop',
      online: true,
      lastSeenAt: '2026-10-07T10:00:00.000Z',
      planLimitResetsAt: null,
    },
    prompt: 'List the files in this folder and name one.',
    ...overrides,
  };
}

/** An agent message event with the given id. */
export function messageEvent(id: number, text = `Message ${id}`): RunEvent {
  return {
    id,
    runId: RUN_ID,
    at: '2026-10-07T10:00:01.000Z',
    type: 'agent.message',
    text,
    truncated: false,
    parentToolUseId: null,
  };
}

export function succeededEvent(id: number): RunEvent {
  return {
    id,
    runId: RUN_ID,
    at: '2026-10-07T10:00:09.000Z',
    type: 'run.succeeded',
    resultText: 'Done',
    truncated: false,
    costUsd: 0.01,
    durationMs: 9000,
    numTurns: 2,
  };
}

/** One SSE message as the API sends it, with the given line ending. */
export function sseMessage(event: RunEvent, newline = '\n'): string {
  return [`id: ${event.id}`, 'event: run-event', `data: ${JSON.stringify(event)}`, '', ''].join(
    newline,
  );
}

/**
 * A text/event-stream response that sends the chunks, then closes, errors as a network drop
 * would, or stays open. A drop can discard chunks the reader has not read yet, as a real one can.
 */
export function sseResponse(chunks: string[], end: 'close' | 'drop' | 'open'): Response {
  const encoder = new TextEncoder();
  const pending = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = pending.shift();
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (end === 'close') controller.close();
      else if (end === 'drop') controller.error(new TypeError('network error'));
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** A text/event-stream response that stays open after the chunks until the test drops it. */
export function droppableSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const opened = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      opened.resolve(controller);
    },
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    drop: async () => (await opened.promise).error(new TypeError('network error')),
  };
}

export const REPOSITORY_ID = '0199c1a2-2222-7000-8000-000000000001';

export function repositoryFixture(overrides: Partial<RepositoryDetail> = {}): RepositoryDetail {
  const role = {
    agent: 'claude_code',
    model: null,
    runsOn: 'local_runner',
    signIn: 'engineer_login',
  } as const;
  return {
    id: REPOSITORY_ID,
    githubRepositoryId: 1001,
    owner: 'acme',
    name: 'app',
    description: 'The web app',
    roleSettings: {
      pre_planning: role,
      planning: role,
      plan_review: role,
      implementation: role,
      implementation_review: role,
      verification: role,
    },
    defaultRunMode: 'manual',
    setup: null,
    createdAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

export const FEATURE_ID = '0199c1a6-4444-7d4e-8f90-a1b2c3d4e5f6';
const TASK_ID = '0199c1a7-5555-7d4e-8f90-a1b2c3d4e5f6';
export const CONTEXT_FILE_ID = '0199c1a8-6666-7d4e-8f90-a1b2c3d4e5f6';

export function featureFixture(overrides: Partial<FeatureDetail> = {}): FeatureDetail {
  const repository = { id: REPOSITORY_ID, owner: 'acme', name: 'app' };
  return {
    id: FEATURE_ID,
    title: 'Export invoices as CSV',
    state: 'pre_planning',
    runMode: 'manual',
    createdAt: '2026-10-09T10:00:00.000Z',
    description: 'Export invoices as CSV from the billing page.',
    ticketUrl: null,
    exploreCodebase: false,
    workflowSettings: {
      decisions: 'ask',
      planCheckIn: 'pause',
      planReview: { findings: 'ask', rounds: { mode: 'ask' } },
      implementationReview: { findings: 'ask', rounds: { mode: 'ask' } },
    },
    repositories: [repository],
    attachments: [],
    tasks: [
      {
        id: TASK_ID,
        kind: 'intake',
        repository,
        topic: null,
        runId: RUN_ID,
        status: 'queued',
        commit: null,
      },
    ],
    contextFiles: [],
    updatedAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

export function contextFileFixture(overrides: Partial<ContextFile> = {}): ContextFile {
  return {
    id: CONTEXT_FILE_ID,
    taskId: TASK_ID,
    featureId: FEATURE_ID,
    title: 'Feature brief',
    ticked: true,
    content: '# Feature brief\n\nExport invoices as CSV.',
    updatedAt: '2026-10-09T10:05:00.000Z',
    ...overrides,
  };
}

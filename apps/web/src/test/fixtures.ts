import type { Run, RunEvent, Runner } from '@plangineer/contracts';
import { delay, http, HttpResponse } from 'msw';
import { AUTH_URL, RPC_URL, rpcBody, server } from './app-harness.tsx';

export const RUNNER_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
export const RUN_ID = '0199c1a3-1111-7d4e-8f90-a1b2c3d4e5f6';
export const COMMIT = '0123456789abcdef0123456789abcdef01234567';

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
    clis: [{ name: 'claude-code', version: '2.1.290', available: true, minimumVersion: '2.1.284' }],
    createdAt: '2026-10-07T09:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

export function runFixture(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    status: 'running',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    attempt: 1,
    cancelRequested: false,
    createdAt: '2026-10-07T10:00:00.000Z',
    startedAt: '2026-10-07T10:00:02.000Z',
    endedAt: null,
    commit: COMMIT,
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

/** Each event type's body, without the stored id, run id and time. */
type EventBody = RunEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'id' | 'runId' | 'at'>
    : never
  : never;

/** A stored run event: the body with an id, the run id and a time. */
export function runEvent(id: number, body: EventBody): RunEvent {
  return { id, runId: RUN_ID, at: '2026-10-07T10:00:05.000Z', ...body };
}

export function messageEvent(id: number, text = `Message ${id}`): RunEvent {
  return runEvent(id, { type: 'agent.message', text, truncated: false, parentToolUseId: null });
}

/** A text/event-stream body of run events that stays open, as a live run's stream does. */
export function sseResponse(events: readonly RunEvent[]): Response {
  // A keepalive comment first, as the API sends, so the body is never empty.
  const text = [
    ': keepalive\n\n',
    ...events.map(
      (event) => `id: ${event.id}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`,
    ),
  ].join('');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

export const EVENTS_URL = `${window.location.origin}/api/runs/${RUN_ID}/events`;

/**
 * Under MSW's socket-level interception, a run event stream that shares a kept-alive connection
 * with an RPC answer can end early. So every RPC answer closes its connection.
 */
function rpcResponse(json: unknown, status = 200) {
  return HttpResponse.json(rpcBody(json), { status, headers: { Connection: 'close' } });
}

export function rpcError(code: string, status: number, message = 'Request failed') {
  return () => rpcResponse({ defined: status < 500, code, status, message }, status);
}

export const neverAnswers = async () => {
  await delay('infinite');
  return HttpResponse.json(null);
};

/**
 * Answers a procedure with each response in turn, repeating the last, and records each input.
 */
export function answerProcedure(
  path: string,
  ...responses: Array<() => Response | Promise<Response>>
) {
  const inputs: unknown[] = [];
  server.use(
    http.post(`${RPC_URL}/${path}`, async ({ request }) => {
      const body: unknown = await request.json();
      inputs.push(typeof body === 'object' && body !== null && 'json' in body ? body.json : null);
      const respond = responses[Math.min(inputs.length - 1, responses.length - 1)];
      if (respond === undefined) throw new Error(`answerProcedure needs a response for ${path}`);
      return respond();
    }),
  );
  return inputs;
}

export function answerJson(json: unknown) {
  return () => rpcResponse(json);
}

export function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor };
}

/** A signed-in session, so the app layout's session check passes. */
export function answerSignedIn() {
  server.use(
    http.get(`${AUTH_URL}/get-session`, () =>
      HttpResponse.json({ session: { id: 'session' }, user: { id: 'user' } }),
    ),
  );
}

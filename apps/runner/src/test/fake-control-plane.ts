import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  MAX_SOCKET_MESSAGE_BYTES,
  RUNNER_ATTACHMENT_PATH,
  type RunJob,
  RunnerSocketClose,
  RunnerToServerMessage,
  type ServerToRunnerMessage,
} from '@plangineer/contracts';
import { WebSocket, WebSocketServer } from 'ws';
import { rawText } from '../connection/control-plane-socket.ts';

type Message<T extends RunnerToServerMessage['type']> = Extract<RunnerToServerMessage, { type: T }>;
type RunEvents = Message<'run.events'>;

const ATTACHMENT_PREFIX = RUNNER_ATTACHMENT_PATH.replace(':attachmentId', '');

/** An attachment the fake serves on the runner attachment route. */
export interface FakeAttachment {
  mediaType: string;
  content: Buffer;
}

interface ReceivedMessage {
  message: RunnerToServerMessage;
  bytes: number;
  /** Which connection carried it, counting from 1. */
  connection: number;
}

/**
 * A stand-in for the API's runner socket and attachment route, for runner tests. It checks the
 * runner token at the handshake, parses every message with the protocol schemas, records it, and
 * acknowledges events. Tests drive it: assign and cancel runs, answer heartbeats and welcomes,
 * drop or close the socket, and fill `attachments` for the route to serve.
 */
export async function startFakeControlPlane() {
  const token: string = randomUUID();
  const received: ReceivedMessage[] = [];
  const ackedSeqs = new Map<string, number>();
  const waiters = new Set<() => void>();
  let connections = 0;
  let socket: WebSocket | null = null;

  const plane = {
    token,
    serverUrl: '',
    received,
    /** The attachments the route serves by id. Any other id answers 404. */
    attachments: new Map<string, FakeAttachment>(),
    autoAck: true,
    heartbeatIntervalMs: 10_000,
    get connections() {
      return connections;
    },
    heartbeatReply: (_message: Message<'run.heartbeat'>) => ({
      valid: true,
      cancelRequested: false,
    }),
    welcomeRun: (_entry: { runId: string; attempt: number }) => ({ valid: true }),

    send(message: ServerToRunnerMessage): void {
      if (socket === null) throw new Error('No runner is connected');
      socket.send(JSON.stringify(message));
    },
    assign(job: RunJob, runId: string = randomUUID(), attempt = 1): string {
      plane.send({ type: 'run.assign', runId, attempt, job });
      return runId;
    },
    cancel(runId: string, attempt = 1): void {
      plane.send({ type: 'run.cancel', runId, attempt });
    },
    /** Cuts the connection without a close frame, like a network failure. */
    dropSocket(): void {
      socket?.terminate();
    },
    closeSocket(code: number, reason = ''): void {
      socket?.close(code, reason);
    },

    /** Resolves with the first received message, past or future, that matches. */
    waitFor<T extends RunnerToServerMessage>(
      predicate: (message: RunnerToServerMessage) => message is T,
    ): Promise<T> {
      return new Promise((resolve) => {
        const check = () => {
          const found = received.find((entry) => predicate(entry.message))?.message;
          if (found === undefined || !predicate(found)) return false;
          waiters.delete(waiter);
          resolve(found);
          return true;
        };
        const waiter = () => void check();
        if (!check()) waiters.add(waiter);
      });
    },
    /** The highest sequence acknowledged for a run attempt. */
    ackedSeq(runId: string, attempt = 1): number {
      return ackedSeqs.get(`${runId}:${attempt}`) ?? 0;
    },
    /** Acknowledges everything received for a run, as a server that caught up would. */
    acknowledgeAll(runId: string, attempt = 1): void {
      const seq = Math.max(0, ...plane.events(runId).map((entry) => entry.seq));
      ackedSeqs.set(`${runId}:${attempt}`, seq);
      plane.send({ type: 'run.ack', runId, attempt, seq });
    },
    /** Every event the runner sent for a run, in the order received. */
    events(runId: string) {
      return received.flatMap(({ message }) =>
        message.type === 'run.events' && message.runId === runId ? message.events : [],
      );
    },
    /** Resolves once the run's events include one of `type`. */
    waitForEvent(runId: string, type: string): Promise<RunEvents> {
      return plane.waitFor(
        (message): message is RunEvents =>
          message.type === 'run.events' &&
          message.runId === runId &&
          message.events.some((entry) => entry.event.type === type),
      );
    },
    async stop(): Promise<void> {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };

  function acknowledge(message: RunEvents): void {
    const last = message.events.at(-1)?.seq ?? 0;
    const key = `${message.runId}:${message.attempt}`;
    ackedSeqs.set(key, Math.max(ackedSeqs.get(key) ?? 0, last));
    plane.send({ type: 'run.ack', runId: message.runId, attempt: message.attempt, seq: last });
  }

  function reply(message: RunnerToServerMessage): void {
    if (message.type === 'hello') {
      plane.send({
        type: 'welcome',
        runnerId: randomUUID(),
        heartbeatIntervalMs: plane.heartbeatIntervalMs,
        runs: message.activeRuns.map((entry) => ({
          ...entry,
          ...plane.welcomeRun(entry),
          ackedSeq: ackedSeqs.get(`${entry.runId}:${entry.attempt}`) ?? 0,
        })),
      });
    } else if (message.type === 'run.events' && plane.autoAck) acknowledge(message);
    else if (message.type === 'run.heartbeat') {
      const { runId, attempt } = message;
      plane.send({ type: 'run.heartbeat_reply', runId, attempt, ...plane.heartbeatReply(message) });
    }
  }

  /** Answers an attachment as the API does: 401 for a bad token, 404 for an unknown id. */
  function serveAttachment(request: IncomingMessage, response: ServerResponse): void {
    const { pathname } = new URL(request.url ?? '/', 'http://fake');
    const attachment = pathname.startsWith(ATTACHMENT_PREFIX)
      ? plane.attachments.get(decodeURIComponent(pathname.slice(ATTACHMENT_PREFIX.length)))
      : undefined;
    if (request.headers.authorization !== `Bearer ${plane.token}`) {
      response.writeHead(401).end();
    } else if (request.method !== 'GET' || attachment === undefined) {
      response.writeHead(404).end();
    } else {
      response.writeHead(200, { 'content-type': attachment.mediaType }).end(attachment.content);
    }
  }

  const http = createServer(serveAttachment);
  const server = new WebSocketServer({
    server: http,
    path: '/api/runners/socket',
    maxPayload: MAX_SOCKET_MESSAGE_BYTES,
    verifyClient: (info, callback) =>
      callback(info.req.headers.authorization === `Bearer ${plane.token}`, 401),
  });

  server.on('connection', (client) => {
    connections += 1;
    const connection = connections;
    socket = client;
    client.on('message', (data) => {
      const text = rawText(data);
      const parsed = RunnerToServerMessage.safeParse(JSON.parse(text));
      if (!parsed.success) {
        client.close(RunnerSocketClose.policyViolation, 'invalid message');
        throw new Error(`The runner sent an invalid message: ${parsed.error.message}`);
      }
      received.push({ message: parsed.data, bytes: Buffer.byteLength(text), connection });
      if (client === socket) reply(parsed.data);
      for (const waiter of waiters) waiter();
    });
    client.on('close', () => {
      if (client === socket) socket = null;
    });
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('The server has no port');
  plane.serverUrl = `http://127.0.0.1:${address.port}`;
  return plane;
}

export type FakeControlPlane = Awaited<ReturnType<typeof startFakeControlPlane>>;

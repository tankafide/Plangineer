import { upgradeWebSocket, type WebSocketServerLike } from '@hono/node-server';
import {
  MAX_SOCKET_MESSAGE_BYTES,
  RunnerSocketClose,
  RunnerToServerMessage,
  type ServerToRunnerMessage,
} from '@plangineer/contracts';
import type { Context, Next } from 'hono';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { advanceSetupOfRun } from '../setup/setup-advance.ts';
import type { Logger } from '../logger.ts';
import type { HeldSocket, RunnerConnections } from './runner-connections.ts';
import { findRunnerByToken } from './runner-service.ts';
import {
  acceptHeartbeat,
  acceptHello,
  acceptPong,
  acceptRunEvents,
  acceptRunnerStatus,
} from './runner-session.ts';

export const RUNNER_SOCKET_PATH = '/api/runners/socket';

/** A close reason is at most 123 bytes. */
const MAX_CLOSE_REASON_BYTES = 123;
const INTERNAL_ERROR_CLOSE = 1011;

/**
 * @hono/node-server drives a ws server, but its structural type does not match @types/ws's
 * overloads. This guard checks at runtime what that type needs: a ws server with noServer.
 */
function isWebSocketServerLike(server: unknown): server is WebSocketServerLike {
  return server instanceof WebSocketServer && server.options.noServer === true;
}

/** The ws server behind the upgrade route. A message over 1 MiB closes its socket with 1009. */
export function createRunnerSocketServer(): WebSocketServerLike {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_SOCKET_MESSAGE_BYTES });
  if (!isWebSocketServerLike(server)) throw new Error('The runner socket server needs noServer');
  return server;
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1];
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function closeReason(text: string): string {
  const bytes = Buffer.from(text);
  return bytes.length <= MAX_CLOSE_REASON_BYTES
    ? text
    : bytes.subarray(0, MAX_CLOSE_REASON_BYTES).toString('utf8').replace(/�+$/, '');
}

/** Parses one text frame, or returns the reason it breaks the protocol. */
function parseMessage(data: unknown): RunnerToServerMessage | { error: string } {
  if (typeof data !== 'string') return { error: 'Binary messages are not accepted' };
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { error: 'Message is not JSON' };
  }
  const result = RunnerToServerMessage.safeParse(json);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  return {
    error: issue === undefined ? 'Invalid message' : `${issue.path.join('.')}: ${issue.message}`,
  };
}

/** One runner's connection: answers its messages in order, and pings it to see it is alive. */
function runnerSession(
  deps: ServiceDeps,
  connections: RunnerConnections,
  runnerId: string,
  socket: WebSocket,
): void {
  const logger: Logger = deps.logger.child({ runnerId });
  const send = (message: ServerToRunnerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const close = (code: number, reason: string) => socket.close(code, closeReason(reason));
  const held: HeldSocket = { send, close };

  async function handle(message: RunnerToServerMessage): Promise<void> {
    switch (message.type) {
      case 'hello':
        send(await acceptHello(deps, runnerId, message));
        await connections.dispatch(runnerId);
        return;
      case 'run.events': {
        const accepted = await acceptRunEvents(deps, runnerId, message);
        if (accepted === undefined) {
          logger.info(
            { runId: message.runId, attempt: message.attempt },
            'Stale run events ignored',
          );
          return;
        }
        send({
          type: 'run.ack',
          runId: message.runId,
          attempt: message.attempt,
          seq: accepted.ackedSeq,
        });
        if (accepted.ended) await advanceSetupOfRun(deps, message.runId);
        return;
      }
      case 'run.heartbeat':
        send(await acceptHeartbeat(deps, runnerId, message));
        return;
      case 'runner.status':
        await acceptRunnerStatus(deps, runnerId, message);
        if (message.planLimitResetsAt === null) await connections.dispatch(runnerId);
        return;
      default: {
        const unhandled: never = message;
        throw new Error(`Unhandled runner message ${JSON.stringify(unhandled)}`);
      }
    }
  }

  let queue = Promise.resolve();
  function receive(data: unknown): void {
    queue = queue.then(async () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const message = parseMessage(data);
      if ('error' in message) {
        logger.warn({ reason: message.error }, 'Runner message rejected');
        close(RunnerSocketClose.policyViolation, message.error);
        return;
      }
      try {
        await handle(message);
      } catch (error) {
        logger.error({ err: error, type: message.type }, 'Runner message failed');
        close(INTERNAL_ERROR_CLOSE, 'Internal error');
      }
    });
  }

  let alive = true;
  const pinger = setInterval(() => {
    if (!alive) {
      logger.info('Runner missed a ping');
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, deps.env.RUNNER_HEARTBEAT_INTERVAL_MS);
  socket.on('pong', () => {
    alive = true;
    acceptPong(deps, runnerId).catch((error: unknown) => {
      logger.error({ err: error }, 'Runner pong could not be recorded');
    });
  });
  socket.on('message', (data, isBinary) => receive(isBinary ? data : textOf(data)));
  socket.on('close', (code) => {
    clearInterval(pinger);
    connections.detach(runnerId, held);
    logger.info({ code }, 'Runner disconnected');
  });
  connections.attach(runnerId, held);
  logger.info('Runner connected');
}

/**
 * The runner WebSocket route. It answers 401 before the upgrade unless the bearer token
 * belongs to an active runner, so no message is handled before the runner is known.
 */
export function runnerSocketRoute(deps: ServiceDeps, connections: RunnerConnections) {
  return async (c: Context, next: Next) => {
    const token = bearerToken(c.req.header('authorization'));
    const runner = token === undefined ? undefined : await findRunnerByToken(deps.db, token);
    if (runner === undefined) return c.text('Unauthorized', 401);
    const upgrade = upgradeWebSocket(() => ({
      onOpen: (_event, ws) => {
        if (!(ws.raw instanceof WebSocket)) throw new Error('Runner socket is not a ws WebSocket');
        runnerSession(deps, connections, runner.id, ws.raw);
      },
    }));
    return upgrade(c, next);
  };
}

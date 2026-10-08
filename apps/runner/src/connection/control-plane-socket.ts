import {
  MAX_SOCKET_MESSAGE_BYTES,
  RunnerSocketClose,
  type RunnerToServerMessage,
  ServerToRunnerMessage,
} from '@plangineer/contracts';
import { WebSocket } from 'ws';
import type { Logger } from '../config/runner-logger.ts';

const RECONNECT_BASE_MS = 1_000;
/** Stays under the heartbeat interval, so a short API restart does not cost a lease. */
const RECONNECT_CAP_MS = 5_000;
const UNAUTHORIZED = 401;
/** A close reason must fit a 125-byte control frame with its code. */
const MAX_CLOSE_REASON_LENGTH = 120;

/** Why the runner must stop instead of reconnecting. */
export type SocketFatal =
  | { kind: 'revoked' }
  | { kind: 'replaced' }
  | { kind: 'protocol'; code: number; reason: string };

export interface ControlPlaneSocketOptions {
  /** The control plane's origin, such as `https://plangineer.example.com`. */
  serverUrl: string;
  token: string;
  logger: Logger;
  onOpen(): void;
  onMessage(message: ServerToRunnerMessage): void;
  onFatal(fatal: SocketFatal): void;
}

export interface ControlPlaneSocket {
  /** Sends a message on the open socket. Returns false when there is none. */
  send(message: RunnerToServerMessage): boolean;
  /** Closes the socket with a normal close and stops reconnecting. */
  close(): void;
}

function socketUrl(serverUrl: string): string {
  const url = new URL('/api/runners/socket', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** A full-jitter delay that doubles from 1 s up to the 5 s cap. */
function reconnectDelay(failures: number): number {
  return Math.random() * Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** failures);
}

/** The text of a WebSocket message, however ws delivered its bytes. */
export function rawText(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function closeFatal(code: number, reason: string): SocketFatal | null {
  if (code === RunnerSocketClose.revoked) return { kind: 'revoked' };
  if (code === RunnerSocketClose.replaced) return { kind: 'replaced' };
  if (code === RunnerSocketClose.policyViolation || code === RunnerSocketClose.messageTooBig) {
    return { kind: 'protocol', code, reason };
  }
  return null;
}

/**
 * The runner's one outbound WebSocket. It authenticates with the runner token, reconnects with
 * backoff after a lost connection, and stops for good on a close that reconnecting cannot fix.
 */
export function connectControlPlane(options: ControlPlaneSocketOptions): ControlPlaneSocket {
  const { logger } = options;
  const url = socketUrl(options.serverUrl);
  let current: WebSocket | null = null;
  let failures = 0;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | undefined;

  function stop(fatal: SocketFatal | null): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(reconnectTimer);
    const socket = current;
    current = null;
    socket?.close(RunnerSocketClose.normal);
    if (fatal !== null) options.onFatal(fatal);
  }

  function reconnect(): void {
    if (stopped) return;
    current = null;
    const delay = reconnectDelay(failures);
    failures += 1;
    logger.info({ delayMs: Math.round(delay) }, 'Reconnecting to the control plane');
    reconnectTimer = setTimeout(dial, delay);
  }

  function rejectMessage(reason: string): void {
    logger.error({ reason }, 'The control plane sent an invalid message');
    current?.close(RunnerSocketClose.policyViolation, reason.slice(0, MAX_CLOSE_REASON_LENGTH));
    stop({ kind: 'protocol', code: RunnerSocketClose.policyViolation, reason });
  }

  function handleMessage(data: WebSocket.RawData): void {
    let value: unknown;
    try {
      value = JSON.parse(rawText(data));
    } catch {
      rejectMessage('The message is not JSON');
      return;
    }
    const parsed = ServerToRunnerMessage.safeParse(value);
    if (parsed.success) options.onMessage(parsed.data);
    else rejectMessage(parsed.error.issues[0]?.message ?? parsed.error.message);
  }

  function dial(): void {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${options.token}` },
      maxPayload: MAX_SOCKET_MESSAGE_BYTES,
    });
    current = socket;
    const isCurrent = () => socket === current;

    socket.on('open', () => {
      if (!isCurrent()) return;
      failures = 0;
      options.onOpen();
    });
    socket.on('message', (data) => {
      if (isCurrent()) handleMessage(data);
    });
    socket.on('unexpected-response', (request, response) => {
      request.destroy();
      if (!isCurrent()) return;
      if (response.statusCode === UNAUTHORIZED) stop({ kind: 'revoked' });
      else {
        logger.warn({ status: response.statusCode }, 'The control plane refused the socket');
        reconnect();
      }
    });
    socket.on('error', (error) => {
      if (isCurrent()) logger.warn({ err: error }, 'The control plane socket failed');
    });
    socket.on('close', (code, reasonBuffer) => {
      if (!isCurrent()) return;
      const reason = reasonBuffer.toString();
      const fatal = closeFatal(code, reason);
      if (fatal === null) {
        logger.warn({ code, reason }, 'Lost the control plane socket');
        reconnect();
      } else stop(fatal);
    });
  }

  dial();

  return {
    send(message) {
      if (current?.readyState !== WebSocket.OPEN) return false;
      current.send(JSON.stringify(message));
      return true;
    },
    close: () => stop(null),
  };
}

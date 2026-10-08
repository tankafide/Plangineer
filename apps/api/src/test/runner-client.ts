import { type RunnerToServerMessage, ServerToRunnerMessage } from '@plangineer/contracts';
import { WebSocket } from 'ws';

type Received<T extends ServerToRunnerMessage['type']> = Extract<
  ServerToRunnerMessage,
  { type: T }
>;

export interface Closed {
  code: number;
  reason: string;
}

/** A runner's side of the socket for API tests: sends messages and waits for replies by type. */
export class TestRunnerClient {
  readonly received: ServerToRunnerMessage[] = [];
  readonly closed: Promise<Closed>;
  readonly #socket: WebSocket;
  readonly #waiters = new Set<() => void>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    this.closed = new Promise((resolve) => {
      socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    socket.on('message', (data: Buffer) => {
      this.received.push(ServerToRunnerMessage.parse(JSON.parse(data.toString('utf8'))));
      for (const wake of this.#waiters) wake();
    });
  }

  /** Opens a socket with the token, resolving once open or rejecting with the HTTP status. */
  static connect(
    port: number,
    token: string,
    { autoPong = true }: { autoPong?: boolean } = {},
  ): Promise<TestRunnerClient> {
    const socket = new WebSocket(`ws://localhost:${port}/api/runners/socket`, {
      headers: { authorization: `Bearer ${token}` },
      autoPong,
    });
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new TestRunnerClient(socket)));
      socket.once('unexpected-response', (_request, response) => {
        reject(new Error(`Handshake answered ${response.statusCode}`));
      });
      socket.once('error', reject);
    });
  }

  send(message: RunnerToServerMessage | Record<string, unknown>): void {
    this.#socket.send(JSON.stringify(message));
  }

  sendRaw(data: string): void {
    this.#socket.send(data);
  }

  /** Resolves with the first message of the type received after skipping `skip` of them. */
  async next<T extends ServerToRunnerMessage['type']>(type: T, skip = 0): Promise<Received<T>> {
    const find = () =>
      this.received.filter((message): message is Received<T> => message.type === type)[skip];
    const found = find();
    if (found !== undefined) return found;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`No ${type} message arrived`));
      }, 5_000);
      const check = () => {
        const message = find();
        if (message === undefined) return;
        clearTimeout(timer);
        this.#waiters.delete(check);
        resolve(message);
      };
      this.#waiters.add(check);
    });
  }

  close(): void {
    this.#socket.close();
  }
}

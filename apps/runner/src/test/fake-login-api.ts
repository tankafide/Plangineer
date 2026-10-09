import { createServer, type IncomingHttpHeaders } from 'node:http';
import { text } from 'node:stream/consumers';

export const USER_CODE = 'ABCD-EFGH-JKMN';
export const DEVICE_SECRET = 'A'.repeat(43);
export const EXPIRES_AT = '2026-10-08T12:00:00.000Z';

interface RecordedRequest {
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/** One procedure answer: its HTTP status, 200 when left out, and its JSON. */
export type LoginReply = { status?: number; json: unknown };

export const tooManyRequests: LoginReply = {
  status: 429,
  json: { defined: true, code: 'TOO_MANY_REQUESTS', status: 429, message: 'Too many' },
};

export const internalError = (message: string): LoginReply => ({
  status: 500,
  json: { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message },
});

/**
 * A stand-in for the API's `runner.startLogin` and `runner.pollLogin`, for login tests. It answers
 * in oRPC's RPC wire format and records each request. Tests set the replies: polls take
 * `pollReplies` in order and repeat the last one.
 */
export async function startFakeLoginApi() {
  const server = createServer((request, response) => {
    void text(request).then((body) => {
      api.requests.push({ path: request.url, headers: request.headers, body: JSON.parse(body) });
      const reply =
        request.url === '/rpc/runner/startLogin'
          ? api.startReply
          : (api.pollReplies.shift() ?? api.pollReplies.at(-1));
      response.writeHead(reply?.status ?? 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ json: reply?.json, meta: [] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The server has no port');
  const serverUrl = `http://127.0.0.1:${address.port}`;
  const approveUrl = `${serverUrl}/runners/approve?code=${USER_CODE}`;

  const api = {
    serverUrl,
    approveUrl,
    requests: [] as RecordedRequest[],
    startReply: {
      json: {
        deviceSecret: DEVICE_SECRET,
        userCode: USER_CODE,
        approveUrl,
        expiresAt: EXPIRES_AT,
        pollIntervalMs: 20,
      },
    } as LoginReply,
    pollReplies: [] as LoginReply[],
    /** Stops answering, so the next request fails to connect. Closing twice is harmless. */
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return api;
}

export type FakeLoginApi = Awaited<ReturnType<typeof startFakeLoginApi>>;

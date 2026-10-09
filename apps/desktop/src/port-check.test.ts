import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPortFree, isPortFree } from './port-check.ts';

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No port');
      resolve({ server, port: address.port });
    });
  });
}

describe('port check', () => {
  let busy: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => busy?.close(resolve) ?? resolve(undefined));
    busy = undefined;
  });

  it('finds a port in use busy and a released one free', async () => {
    const { server, port } = await listen();
    busy = server;

    expect(await isPortFree('127.0.0.1', port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    busy = undefined;
    expect(await isPortFree('127.0.0.1', port)).toBe(true);
  });

  it('fails a busy port naming the port and server.env', async () => {
    const { server, port } = await listen();
    busy = server;
    const serverEnv = '/config/Plangineer/server.env';

    await expect(assertPortFree('127.0.0.1', port, serverEnv)).rejects.toThrow(
      `Port ${port} is in use by another program. Free it, or change the port in ${serverEnv} as the desktop app guide describes.`,
    );
  });
});

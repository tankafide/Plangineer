import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findBusyPorts } from './ports.mjs';

function listen() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => resolve(server));
  });
}

describe('findBusyPorts', () => {
  const servers = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  it('returns a port something is listening on, and not a free one', async () => {
    const busy = await listen();
    const free = await listen();
    servers.push(busy);
    const freePort = free.address().port;
    await new Promise((done) => free.close(done));

    expect(await findBusyPorts([busy.address().port, freePort])).toEqual([busy.address().port]);
  });
});

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * The install every test starts from: its GitHub App is set up. A test of the setup states
 * overrides it with server.use, and resetHandlers brings it back.
 */
const configuredInstance = http.post(`${window.location.origin}/rpc/instance/getStatus`, () =>
  HttpResponse.json(
    { json: { githubApp: 'configured', githubAppSlug: 'plangineer-test' }, meta: [] },
    { headers: { Connection: 'close' } },
  ),
);

/** The MSW server every test file shares; src/test/setup.ts starts and resets it. */
export const server = setupServer(configuredInstance);

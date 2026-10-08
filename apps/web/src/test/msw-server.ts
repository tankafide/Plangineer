import { setupServer } from 'msw/node';

/** The MSW server every test file shares; src/test/setup.ts starts and resets it. */
export const server = setupServer();

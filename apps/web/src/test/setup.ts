import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';
import { server } from './msw-server.ts';

// Listen before any app module loads: Better Auth's client keeps the fetch it sees at import.
// So this file imports nothing that imports the app.
server.listen({ onUnhandledFrame: 'error' });

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

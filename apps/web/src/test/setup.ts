import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';
import { server } from './app-harness.tsx';

// Listen before any test module loads: Better Auth's client keeps the fetch it sees at import.
server.listen({ onUnhandledFrame: 'error' });

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

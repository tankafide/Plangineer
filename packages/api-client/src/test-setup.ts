import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './test-utils.tsx';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
// Unmount every rendered hook, so an open run event stream never outlives its test.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

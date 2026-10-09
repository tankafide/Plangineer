import type { LocalStack } from './stack.ts';

/**
 * Holds the running stack and any start in progress. A stop during startup waits for the start
 * to settle, then stops what it started, so a quit while the stack starts leaves no Postgres
 * running. A failed start has already stopped what it had started.
 */
export function createStackSlot() {
  let current: LocalStack | undefined;
  let starting: Promise<LocalStack> | undefined;

  return {
    get stack(): LocalStack | undefined {
      return current;
    },

    async start(startStack: () => Promise<LocalStack>): Promise<LocalStack> {
      starting = startStack();
      current = await starting;
      return current;
    },

    async stop(): Promise<void> {
      await starting?.catch(() => undefined);
      const stopping = current;
      current = undefined;
      await stopping?.stop();
    },
  };
}

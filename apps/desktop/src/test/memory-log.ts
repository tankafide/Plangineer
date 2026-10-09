import type { DesktopLog } from '../desktop-log.ts';

/** A desktop log that keeps its lines in memory, for unit tests. */
export function memoryLog(): DesktopLog & { lines: string[] } {
  const lines: string[] = [];
  const write = (message: unknown) => {
    lines.push(message instanceof Error ? message.message : String(message));
  };
  return {
    lines,
    debug: write,
    info: write,
    warn: write,
    error: write,
    addSecret: () => {},
  };
}

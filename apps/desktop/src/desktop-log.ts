import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** The desktop's own log, which electron-updater also writes to as its `logger`. */
export interface DesktopLog {
  debug(message: unknown): void;
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  /** Masks a value wherever a later line holds it, such as the Postgres password. */
  addSecret(value: string): void;
  close(): Promise<void>;
}

const REDACTED = '[redacted]';

function text(message: unknown): string {
  if (message instanceof Error) return message.stack ?? message.message;
  return typeof message === 'string' ? message : JSON.stringify(message);
}

/** Appends timestamped lines to `desktop.log`, never writing a registered secret. */
export function createDesktopLog(file: string): DesktopLog {
  mkdirSync(path.dirname(file), { recursive: true });
  const stream: WriteStream = createWriteStream(file, { flags: 'a' });
  const secrets = new Set<string>();

  function write(level: Level, message: unknown): void {
    let line = text(message);
    for (const secret of secrets) line = line.replaceAll(secret, REDACTED);
    stream.write(`${new Date().toISOString()} ${level} ${line}\n`);
  }

  return {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    addSecret: (value) => {
      if (value !== '') secrets.add(value);
    },
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}

import { fileURLToPath } from 'node:url';
import { pino, type Level, type Logger } from 'pino';

const LOG_FILE = fileURLToPath(new URL('../../../logs/api.log', import.meta.url));

export type { Logger };

/** The API's root logger: JSON to stdout and to logs/api.log, with credentials redacted. */
export function createLogger(level: Level): Logger {
  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      { target: 'pino/file', level, options: { destination: LOG_FILE, mkdir: true } },
    ],
  });
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.token',
          '*.secret',
          '*.clientSecret',
          '*.deviceSecret',
          '*.userCode',
        ],
      },
    },
    transport,
  );
}

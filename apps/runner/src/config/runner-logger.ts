import { pino, type Level, type Logger } from 'pino';

export type { Logger };

/** The runner's logger: JSON to stdout and to `logFile`, with tokens, login secrets and auth redacted. */
export function createRunnerLogger(level: Level, logFile: string): Logger {
  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      { target: 'pino/file', level, options: { destination: logFile, mkdir: true } },
    ],
  });
  return pino(
    {
      level,
      redact: {
        paths: [
          'token',
          'deviceSecret',
          'userCode',
          'authorization',
          '*.token',
          '*.deviceSecret',
          '*.userCode',
          '*.authorization',
        ],
      },
    },
    transport,
  );
}

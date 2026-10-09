import { pino, type Level, type Logger } from 'pino';

export type { Logger };

/** The runner's logger: JSON to stdout and to `logFile`, with tokens, login secrets and auth redacted. */
export function createRunnerLogger(level: Level, logFile: string): Logger {
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
    pino.multistream([
      { level, stream: process.stdout },
      { level, stream: pino.destination({ dest: logFile, mkdir: true, sync: false }) },
    ]),
  );
}

import { pino, type Level, type Logger } from 'pino';

export type { Logger };

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.token',
  '*.secret',
  '*.deviceSecret',
  '*.userCode',
  // GitHub App setup: the setup token, the manifest code and the App's secrets.
  'setupToken',
  '*.setupToken',
  'input.code',
  '*.input.code',
  'clientSecret',
  '*.clientSecret',
  'client_secret',
  '*.client_secret',
  'pem',
  '*.pem',
  'privateKey',
  '*.privateKey',
];

/**
 * The API's root logger: JSON to stdout, and to `logFile` when one is given, with credentials
 * redacted. Each stream carries the level, since a multistream entry with none defaults to info.
 */
export function createLogger(level: Level, logFile?: string): Logger {
  const streams: pino.StreamEntry[] = [{ level, stream: process.stdout }];
  if (logFile !== undefined) {
    streams.push({ level, stream: pino.destination({ dest: logFile, mkdir: true, sync: false }) });
  }
  return pino({ level, redact: { paths: REDACT_PATHS } }, pino.multistream(streams));
}

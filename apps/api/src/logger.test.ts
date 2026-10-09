import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.ts';

let dir: string;
let stdout: string[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'api-logger-'));
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function fileText(logFile: string, message: string): Promise<string> {
  await vi.waitFor(async () => expect(await readFile(logFile, 'utf8')).toContain(message));
  return readFile(logFile, 'utf8');
}

describe('createLogger', () => {
  it('writes each line to stdout and to the log file, creating its folder, with credentials redacted', async () => {
    const logFile = path.join(dir, 'nested', 'api.log');
    const logger = createLogger('info', logFile);

    logger.info(
      { req: { headers: { authorization: 'Bearer x', cookie: 'session=y' } }, run: { token: 't' } },
      'request',
    );
    logger.flush();

    const text = await fileText(logFile, 'request');
    for (const output of [text, stdout.join('')]) {
      expect(output).not.toContain('Bearer x');
      expect(output).not.toContain('session=y');
      expect(JSON.parse(output)).toMatchObject({
        msg: 'request',
        req: { headers: { authorization: '[Redacted]', cookie: '[Redacted]' } },
        run: { token: '[Redacted]' },
      });
    }
  });

  it('writes a debug line to both outputs at level debug', async () => {
    const logFile = path.join(dir, 'api.log');
    const logger = createLogger('debug', logFile);

    logger.debug('detail');
    logger.flush();

    expect(JSON.parse(await fileText(logFile, 'detail'))).toMatchObject({ msg: 'detail' });
    expect(stdout.join('')).toContain('"msg":"detail"');
  });

  it('writes to stdout only when no file is given', () => {
    const logger = createLogger('error');

    logger.error('broken');

    expect(stdout.join('')).toContain('"msg":"broken"');
  });
});

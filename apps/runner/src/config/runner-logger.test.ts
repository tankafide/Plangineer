import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunnerLogger } from './runner-logger.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'runner-logger-'));
});

afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));

describe('createRunnerLogger', () => {
  it('writes JSON lines to the log file with tokens, login secrets and authorization redacted', async () => {
    const logFile = path.join(dir, 'logs', 'runner.log');
    const logger = createRunnerLogger('fatal', logFile);

    logger.fatal(
      {
        token: 'secret-token',
        deviceSecret: 'secret-device',
        userCode: 'ABCD-EFGH-JKMN',
        code: 1006,
        headers: { authorization: 'Bearer x' },
      },
      'paired',
    );
    logger.flush();

    await vi.waitFor(async () => expect(await readFile(logFile, 'utf8')).toContain('paired'));
    const text = await readFile(logFile, 'utf8');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('secret-device');
    expect(text).not.toContain('ABCD-EFGH-JKMN');
    expect(text).not.toContain('Bearer x');
    expect(JSON.parse(text)).toMatchObject({
      msg: 'paired',
      token: '[Redacted]',
      deviceSecret: '[Redacted]',
      userCode: '[Redacted]',
      code: 1006,
    });
  });
});

import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { setEnvValues } from './env-file.mjs';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----\n';

describe('setEnvValues', () => {
  it('round-trips a multi-line PEM through util.parseEnv', () => {
    const text = setEnvValues('A=1\n', { APP_PRIVATE_KEY: PEM });

    expect(parseEnv(text)).toEqual({ A: '1', APP_PRIVATE_KEY: PEM });
  });

  it('round-trips a PEM that arrives with CRLF endings as LF', () => {
    const text = setEnvValues('', { KEY: PEM.replaceAll('\n', '\r\n') });

    expect(parseEnv(text)).toEqual({ KEY: PEM });
  });

  it('replaces an existing key in place', () => {
    const text = setEnvValues('A=1\nB=replace-me\nC=3\n', { B: '2' });

    expect(text).toBe('A=1\nB=2\nC=3\n');
  });

  it('appends a missing key', () => {
    expect(setEnvValues('A=1\n', { B: '2' })).toBe('A=1\nB=2\n');
  });

  it('writes LF endings for CRLF input', () => {
    expect(setEnvValues('# comment\r\nA=1\r\n', { A: '2' })).toBe('# comment\nA=2\n');
  });

  it('does not match a key that only shares a prefix', () => {
    expect(setEnvValues('RUNNER_ID_OLD=1\n', { RUNNER_ID: '2' })).toBe(
      'RUNNER_ID_OLD=1\nRUNNER_ID=2\n',
    );
  });
});

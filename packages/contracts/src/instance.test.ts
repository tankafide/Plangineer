import { describe, expect, it } from 'vitest';
import {
  InstanceCompleteGithubAppInput,
  InstanceGithubAppManifestInput,
  InstanceGithubAppManifestOutput,
  InstanceStatus,
} from './instance.ts';

const TOKEN = 'a'.repeat(32);

describe('InstanceGithubAppManifestInput', () => {
  it('accepts a 32-character token', () => {
    expect(InstanceGithubAppManifestInput.parse({ setupToken: TOKEN })).toEqual({
      setupToken: TOKEN,
    });
  });

  it.each([
    ['a 31-character token', { setupToken: 'a'.repeat(31) }],
    ['a 201-character token', { setupToken: 'a'.repeat(201) }],
    ['an unknown key', { setupToken: TOKEN, extra: 1 }],
  ])('rejects %s', (_, input) => {
    expect(InstanceGithubAppManifestInput.safeParse(input).success).toBe(false);
  });
});

describe('InstanceCompleteGithubAppInput', () => {
  it('accepts a token and a code', () => {
    const input = { setupToken: TOKEN, code: 'a1B2_c3-d4' };
    expect(InstanceCompleteGithubAppInput.parse(input)).toEqual(input);
  });

  it.each([
    ['a 31-character token', { setupToken: 'a'.repeat(31), code: 'abc' }],
    ['a code with a /', { setupToken: TOKEN, code: 'ab/c' }],
    ['an empty code', { setupToken: TOKEN, code: '' }],
    ['a 101-character code', { setupToken: TOKEN, code: 'a'.repeat(101) }],
    ['an unknown key', { setupToken: TOKEN, code: 'abc', extra: 1 }],
  ])('rejects %s', (_, input) => {
    expect(InstanceCompleteGithubAppInput.safeParse(input).success).toBe(false);
  });
});

describe('InstanceStatus', () => {
  it.each([
    { githubApp: 'missing', githubAppSlug: null },
    { githubApp: 'configured', githubAppSlug: 'plangineer-abc123' },
  ])('accepts $githubApp', (status) => {
    expect(InstanceStatus.parse(status)).toEqual(status);
  });

  it('rejects an unknown state', () => {
    expect(InstanceStatus.safeParse({ githubApp: 'pending', githubAppSlug: null }).success).toBe(
      false,
    );
  });

  it('strips an unknown key', () => {
    expect(
      InstanceStatus.parse({ githubApp: 'missing', githubAppSlug: null, clientSecret: 'x' }),
    ).toEqual({ githubApp: 'missing', githubAppSlug: null });
  });
});

describe('InstanceGithubAppManifestOutput', () => {
  const output = { postUrl: 'https://github.com/settings/apps/new', manifest: '{}' };

  it('accepts a post URL and a manifest', () => {
    expect(InstanceGithubAppManifestOutput.parse(output)).toEqual(output);
  });

  it('rejects a manifest over 10,000 characters', () => {
    expect(
      InstanceGithubAppManifestOutput.safeParse({ ...output, manifest: 'a'.repeat(10_001) })
        .success,
    ).toBe(false);
  });

  it('strips an unknown key', () => {
    expect(InstanceGithubAppManifestOutput.parse({ ...output, extra: 1 })).toEqual(output);
  });
});

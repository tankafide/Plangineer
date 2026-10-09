import { describe, expect, it } from 'vitest';
import { missingAssets } from './release-assets.mjs';

const COMPLETE = [
  'Plangineer-Setup-0.1.0.exe',
  'Plangineer-Setup-0.1.0.exe.blockmap',
  'Plangineer-0.1.0-arm64.dmg',
  'Plangineer-0.1.0-x64.dmg',
  'Plangineer-0.1.0-arm64.zip',
  'Plangineer-0.1.0.AppImage',
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
];

describe('missingAssets', () => {
  it('finds nothing missing in a complete release', () => {
    expect(missingAssets('v0.1.0', COMPLETE)).toEqual([]);
  });

  it('names each missing installer and update file', () => {
    const partial = COMPLETE.filter(
      (name) => name !== 'Plangineer-0.1.0-x64.dmg' && name !== 'latest-linux.yml',
    );

    expect(missingAssets('v0.1.0', partial)).toEqual([
      'Plangineer-0.1.0-x64.dmg',
      'latest-linux.yml',
    ]);
  });

  it('expects the version the tag names', () => {
    expect(missingAssets('v0.2.0', COMPLETE)).toContain('Plangineer-Setup-0.2.0.exe');
  });

  it('refuses a tag that is not v<version>', () => {
    expect(() => missingAssets('0.1.0', COMPLETE)).toThrow(
      '0.1.0 is not a tag of the form v<major>.<minor>.<patch>',
    );
  });
});

import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { binPath } from './bin-path.mjs';

describe('binPath', () => {
  it('resolves a bin declared as a map, even when exports hides package.json', () => {
    const bin = binPath('dependency-cruiser');

    expect(path.basename(bin)).toBe('dependency-cruiser.mjs');
    expect(existsSync(bin)).toBe(true);
  });

  it('resolves a named bin from the map', () => {
    expect(path.basename(binPath('dependency-cruiser', 'depcruise-fmt'))).toBe('depcruise-fmt.mjs');
  });

  it('resolves a bin declared as a map with one entry', () => {
    expect(existsSync(binPath('oxfmt'))).toBe(true);
  });

  it('names a bin the package does not declare', () => {
    expect(() => binPath('oxfmt', 'missing')).toThrow('oxfmt has no bin named missing');
  });
});

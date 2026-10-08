import { describe, expect, it } from 'vitest';
import { lintTargets, parseStatusPaths, shouldRunVerify } from './claude-hooks.mjs';

describe('lintTargets', () => {
  it.each([
    'apps/api/src/app.ts',
    'apps/web/src/main.tsx',
    'scripts/verify.mjs',
    '.dependency-cruiser.cjs',
    'package.json',
    'C:\\repo\\apps\\api\\src\\app.ts',
  ])('returns %s', (filePath) => {
    expect(lintTargets(filePath)).toBe(filePath);
  });

  it.each(['docs/plans/plan.md', 'apps/web/src/styles/theme.css', 'lefthook.yml', 'README'])(
    'returns nothing for %s',
    (filePath) => {
      expect(lintTargets(filePath)).toBeUndefined();
    },
  );
});

describe('shouldRunVerify', () => {
  it('is false when the stop hook is already active', () => {
    expect(shouldRunVerify({ stopHookActive: true, changedPaths: ['apps/api/src/app.ts'] })).toBe(
      false,
    );
  });

  it('is false when every changed path is under docs/', () => {
    expect(
      shouldRunVerify({ stopHookActive: false, changedPaths: ['docs/a.md', 'docs/plans/b.md'] }),
    ).toBe(false);
  });

  it('is false when nothing changed', () => {
    expect(shouldRunVerify({ stopHookActive: false, changedPaths: [] })).toBe(false);
  });

  it('is true when a code path changed', () => {
    expect(
      shouldRunVerify({ stopHookActive: false, changedPaths: ['docs/a.md', 'scripts/dev.mjs'] }),
    ).toBe(true);
  });
});

describe('parseStatusPaths', () => {
  it('reads modified, untracked and renamed paths', () => {
    const output = ' M apps/api/src/app.ts\0?? scripts/new.mjs\0R  docs/new.md\0docs/old.md\0';

    expect(parseStatusPaths(output)).toEqual([
      'apps/api/src/app.ts',
      'scripts/new.mjs',
      'docs/new.md',
      'docs/old.md',
    ]);
  });

  it('returns nothing for a clean tree', () => {
    expect(parseStatusPaths('')).toEqual([]);
  });
});

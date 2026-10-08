import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintTargets, parseStatusPaths, shouldRunVerify } from './claude-hooks.mjs';

describe('lintTargets', () => {
  const root = path.resolve('repo');
  const inRepo = (...parts) => path.join(root, ...parts);

  it.each([
    ['apps/api/src/app.ts'],
    ['apps/web/src/main.tsx'],
    ['scripts/verify.mjs'],
    ['.dependency-cruiser.cjs'],
  ])('format-checks and lints %s', (relative) => {
    const filePath = inRepo(relative);

    expect(lintTargets(filePath, root)).toEqual({ filePath, lint: true });
  });

  it('format-checks a JSON file without linting it', () => {
    const filePath = inRepo('package.json');

    expect(lintTargets(filePath, root)).toEqual({ filePath, lint: false });
  });

  it('checks a path given relative to the repository', () => {
    expect(lintTargets('scripts/verify.mjs', root)).toEqual({
      filePath: 'scripts/verify.mjs',
      lint: true,
    });
  });

  it('checks a file whose name starts with two dots', () => {
    const filePath = inRepo('..eslintrc.cjs');

    expect(lintTargets(filePath, root)).toEqual({ filePath, lint: true });
  });

  it.each(['docs/plans/plan.md', 'apps/web/src/styles/theme.css', 'lefthook.yml', 'README'])(
    'checks nothing for %s',
    (relative) => {
      expect(lintTargets(inRepo(relative), root)).toBeUndefined();
    },
  );

  it.each([
    path.join(path.dirname(root), 'scratchpad', 'notes.json'),
    path.join(path.dirname(root), 'other-repo', 'src', 'app.ts'),
  ])('checks nothing outside the repository: %s', (filePath) => {
    expect(lintTargets(filePath, root)).toBeUndefined();
  });
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

import { describe, expect, it } from 'vitest';
import { BASELINE_CATALOG } from './baseline-catalog.ts';
import { recommendSkills, type RecommendInput } from './skill-recommendation.ts';

function input(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return { paths: [], dependencies: new Set(), existingSkillNames: new Set(), ...overrides };
}

const byName = (result: ReturnType<typeof recommendSkills>, name: string) =>
  result.find((recommendation) => recommendation.name === name);

describe('recommendSkills', () => {
  it('returns one recommendation per catalog skill in catalog order', () => {
    expect(recommendSkills(input()).map((r) => r.name)).toEqual(
      BASELINE_CATALOG.map((entry) => entry.name),
    );
  });

  it('recommends an always skill with its reason and kind', () => {
    expect(byName(recommendSkills(input()), 'security')).toEqual({
      name: 'security',
      kind: 'template',
      recommended: true,
      required: false,
      reason: 'Every repository needs it',
    });
  });

  it.each([
    [
      'a directory segment',
      { paths: ['db/migrations/0001.sql'] },
      'data-model-design',
      'Found a `migrations` folder',
    ],
    [
      'a file name',
      { paths: ['prisma/schema.prisma'] },
      'data-model-design',
      'Found `schema.prisma`',
    ],
    ['an extension', { paths: ['src/app.tsx'] }, 'frontend', 'Found `.tsx` files'],
    [
      'a dependency',
      { dependencies: new Set(['react']) },
      'frontend',
      'Found `react` in package.json',
    ],
    [
      'a dot directory',
      { paths: ['.github/workflows/ci.yml'] },
      'tooling-and-ci',
      'Found a `.github` folder',
    ],
  ])('recommends on %s', (_, overrides, name, reason) => {
    expect(byName(recommendSkills(input(overrides)), name)).toMatchObject({
      recommended: true,
      reason,
    });
  });

  it('checks directories before file names, extensions and dependencies', () => {
    const result = recommendSkills(
      input({
        paths: ['migrations/schema.prisma', 'api/schema.graphql'],
        dependencies: new Set(['prisma', 'hono']),
      }),
    );
    expect(byName(result, 'data-model-design')?.reason).toBe('Found a `migrations` folder');
    expect(byName(result, 'api-contract-design')?.reason).toBe('Found `.graphql` files');
  });

  it('matches a directory only as a folder, and a dependency only by its exact name', () => {
    const result = recommendSkills(
      input({ paths: ['docs/migrations'], dependencies: new Set(['react-dom', 'preact']) }),
    );
    expect(byName(result, 'data-model-design')).toMatchObject({
      recommended: false,
      reason: 'No signal found',
    });
    expect(byName(result, 'frontend')?.recommended).toBe(false);
  });

  it('skips a skill the repository already has', () => {
    const result = recommendSkills(input({ existingSkillNames: new Set(['testing', 'backend']) }));
    expect(result.map((r) => r.name)).not.toContain('testing');
    expect(result.map((r) => r.name)).not.toContain('backend');
    expect(result).toHaveLength(BASELINE_CATALOG.length - 2);
  });

  it('marks the 10 required skills required', () => {
    expect(
      recommendSkills(input())
        .filter((r) => r.required)
        .map((r) => r.name),
    ).toEqual([
      'codebase-exploration',
      'plan-format',
      'writing-style',
      'finding-verification',
      'plan-conformance',
      'project-stack',
      'architecture-design',
      'testing',
      'code-quality',
      'debugging',
    ]);
  });
});

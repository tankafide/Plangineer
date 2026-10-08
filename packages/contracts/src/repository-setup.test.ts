import { describe, expect, it } from 'vitest';
import {
  RepositoryScan,
  SetupSelection,
  SkillFilePath,
  SkillName,
  SLOT_LINE_PATTERN,
} from './repository-setup.ts';

const AT = '2026-10-08T12:00:00.000Z';

function scan(overrides: Record<string, unknown> = {}) {
  return {
    commit: 'a'.repeat(40),
    defaultBranch: 'main',
    scannedAt: AT,
    skills: [{ name: 'testing', description: 'How we test.', location: 'both' }],
    orchestratorReferences: [],
    unmovableContent: [],
    instructionFiles: ['AGENTS.md'],
    recommendations: [
      {
        name: 'backend',
        kind: 'generated',
        recommended: true,
        required: false,
        reason: 'Found `hono` in package.json',
      },
    ],
    ...overrides,
  };
}

describe('SkillName', () => {
  it.each(['testing', 'a', 'api-contract-design', 'v2-rules', 'x'.repeat(64)])(
    'accepts %s',
    (name) => {
      expect(SkillName.safeParse(name).success).toBe(true);
    },
  );

  it.each(['Testing', '', '-a', 'a-', 'a--b', 'a_b', 'x'.repeat(65)])('rejects %s', (name) => {
    expect(SkillName.safeParse(name).success).toBe(false);
  });
});

describe('SkillFilePath', () => {
  it.each(['.agents/skills/testing/SKILL.md', '.agents/skills/testing/agents/openai.yaml'])(
    'accepts %s',
    (path) => {
      expect(SkillFilePath.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    '.agents/skills/testing',
    '.claude/skills/testing/SKILL.md',
    '.agents/skills/../SKILL.md',
    '.agents/skills/testing/../../README.md',
    '.agents/skills/testing/a b.md',
    `.agents/skills/testing/${'x'.repeat(300)}`,
  ])('rejects %s', (path) => {
    expect(SkillFilePath.safeParse(path).success).toBe(false);
  });
});

describe('SLOT_LINE_PATTERN', () => {
  it.each([
    '<!-- slot: fact test-layers: the test framework for each layer and what it proves -->',
    '<!-- slot: rule pure-core: what stays free of I/O -->',
  ])('matches %s', (line) => {
    expect(SLOT_LINE_PATTERN.test(line)).toBe(true);
  });

  it.each([
    '<!-- slot: note x: y -->',
    '<!-- slot: fact Test: y -->',
    '<!-- slot: fact x: -->',
    ' <!-- slot: fact x: y -->',
    `<!-- slot: fact x: ${'y'.repeat(301)} -->`,
  ])('does not match %s', (line) => {
    expect(SLOT_LINE_PATTERN.test(line)).toBe(false);
  });
});

describe('RepositoryScan', () => {
  it('accepts a scan', () => {
    expect(RepositoryScan.parse(scan())).toEqual(scan());
  });

  it.each([
    [
      '201 skills',
      {
        skills: Array.from({ length: 201 }, () => ({
          name: 'a',
          description: null,
          location: 'agents',
        })),
      },
    ],
    ['51 instruction files', { instructionFiles: Array(51).fill('AGENTS.md') }],
    ['a 301-character path', { instructionFiles: ['x'.repeat(301)] }],
    ['an unknown location', { skills: [{ name: 'a', description: null, location: 'cursor' }] }],
    [
      'a 1,025-character description',
      { skills: [{ name: 'a', description: 'x'.repeat(1_025), location: 'agents' }] },
    ],
  ])('rejects %s', (_, overrides) => {
    expect(RepositoryScan.safeParse(scan(overrides)).success).toBe(false);
  });
});

describe('SetupSelection', () => {
  const selection = {
    reuseSkills: ['testing'],
    addSkills: ['backend'],
    orchestrators: ['plan-orchestrator'],
  };

  it('accepts a selection', () => {
    expect(SetupSelection.parse(selection)).toEqual(selection);
  });

  it.each([
    ['a repeated skill', { addSkills: ['backend', 'backend'] }],
    ['an unknown orchestrator', { orchestrators: ['deploy-orchestrator'] }],
    ['33 added skills', { addSkills: Array.from({ length: 33 }, (_, index) => `s${index}`) }],
    ['an unknown key', { extra: true }],
  ])('rejects %s', (_, overrides) => {
    expect(SetupSelection.safeParse({ ...selection, ...overrides }).success).toBe(false);
  });
});

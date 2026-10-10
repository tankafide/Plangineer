import path from 'node:path';
import {
  type Orchestrator,
  type SetupFile,
  type SetupSelection,
  SLOT_LINE_PATTERN,
} from '@plangineer/contracts';
import { BASELINE_CATALOG } from '@plangineer/domain';
import { describe, expect, it } from 'vitest';
import { testScan } from '../test/setup-fixtures.ts';
import { renderSetupFiles } from './setup-files.ts';

const ORCHESTRATORS: Orchestrator[] = [
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
];
const REQUIRED = BASELINE_CATALOG.filter((entry) => entry.required).map((entry) => entry.name);
const ALL = BASELINE_CATALOG.map((entry) => entry.name);
const REFERENCES = ['execution', 'review-loop', 'git-workflow', 'finding-format'].map(
  (name) => `.agents/skills/orchestrator-references/${name}.md`,
);

function selection(overrides: Partial<SetupSelection> = {}): SetupSelection {
  return { reuseSkills: [], addSkills: REQUIRED, orchestrators: [], ...overrides };
}

const paths = (files: SetupFile[]) => files.map((file) => file.path);
const content = (files: SetupFile[], filePath: string) =>
  files.find((file) => file.path === filePath)?.content ?? '';

/** The skill paths in a rendered orchestrator's routing table, in table order. */
function routedSkills(text: string): string[] {
  return [...text.matchAll(/^\| `\.agents\/skills\/([a-z0-9-]+)\/SKILL\.md` \|/gm)].map(
    (match) => match[1] ?? '',
  );
}

/** Relative link targets in Markdown, outside code spans and fenced blocks. */
function relativeLinks(markdown: string): string[] {
  const prose = markdown
    .replaceAll(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
    .replaceAll(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1] ?? '')
    .filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith('#'));
}

function unresolvedLinks(files: SetupFile[]): string[] {
  const rendered = new Set(paths(files));
  return files.flatMap((file) =>
    relativeLinks(file.content)
      .map((target) => path.posix.join(path.posix.dirname(file.path), target.split('#')[0] ?? ''))
      .filter((target) => !rendered.has(target))
      .map((target) => `${file.path} -> ${target}`),
  );
}

describe('renderSetupFiles', () => {
  it('writes the chosen orchestrators and the references, each routing exactly its skills', () => {
    const scan = testScan({
      skills: [{ name: 'legacy-rules', description: 'Our old rules.', location: 'claude' }],
    });
    const chosen = selection({
      reuseSkills: ['legacy-rules'],
      addSkills: [...REQUIRED, 'security'],
      orchestrators: ['plan-orchestrator', 'implementation-review-orchestrator'],
    });

    const { files } = renderSetupFiles(scan, chosen);

    const orchestratorPaths = paths(files).filter((filePath) => filePath.includes('orchestrator/'));
    expect(orchestratorPaths).toEqual([
      '.agents/skills/plan-orchestrator/SKILL.md',
      '.agents/skills/implementation-review-orchestrator/SKILL.md',
    ]);
    expect(paths(files)).toEqual(expect.arrayContaining(REFERENCES));
    expect(routedSkills(content(files, '.agents/skills/plan-orchestrator/SKILL.md'))).toEqual([
      'architecture-design',
      'codebase-exploration',
      'finding-verification',
      'legacy-rules',
      'plan-format',
      'project-stack',
      'security',
      'testing',
      'writing-style',
    ]);
    expect(
      routedSkills(content(files, '.agents/skills/implementation-review-orchestrator/SKILL.md')),
    ).toEqual([
      'architecture-design',
      'code-quality',
      'legacy-rules',
      'plan-conformance',
      'project-stack',
      'security',
      'testing',
    ]);
    expect(content(files, '.agents/skills/plan-orchestrator/SKILL.md')).toContain(
      '| `.agents/skills/legacy-rules/SKILL.md` | Our old rules. |',
    );
  });

  it('lists the template skills to fill and the generated skills to write', () => {
    const result = renderSetupFiles(testScan(), selection({ addSkills: ALL }));

    expect(result.templateSkills).toEqual(
      BASELINE_CATALOG.filter((entry) => entry.kind === 'template').map((entry) => entry.name),
    );
    expect(result.generateSkills).toEqual(
      BASELINE_CATALOG.filter((entry) => entry.kind === 'generated').map((entry) => entry.name),
    );
    expect(paths(result.files).some((filePath) => filePath.includes('/backend/'))).toBe(false);
  });

  it('writes no placeholder or Plangineer term in any rendered file', () => {
    const { files } = renderSetupFiles(
      testScan({ defaultBranch: 'trunk' }),
      selection({ addSkills: ALL, orchestrators: ORCHESTRATORS }),
    );

    for (const file of files) {
      for (const term of ['{{', 'pnpm', 'stack-decisions', 'apps/', 'Plangineer']) {
        expect(file.content, `${file.path} holds ${term}`).not.toContain(term);
      }
    }
    expect(paths(files)).toContain('.agents/skills/testing/agents/openai.yaml');
    expect(content(files, '.agents/skills/orchestrator-references/git-workflow.md')).toContain(
      'Work reaches `trunk` through a pull request',
    );
  });

  it('writes only the references the repository lacks', () => {
    const { files } = renderSetupFiles(
      testScan({ orchestratorReferences: ['review-loop.md', 'notes.md'] }),
      selection({ orchestrators: ['plan-orchestrator'] }),
    );

    expect(paths(files).filter((filePath) => filePath.includes('orchestrator-references'))).toEqual(
      REFERENCES.filter((filePath) => !filePath.endsWith('/review-loop.md')),
    );
  });

  it('writes the references for skills chosen with no orchestrator', () => {
    const { files } = renderSetupFiles(testScan(), selection());

    expect(paths(files)).toEqual(expect.arrayContaining(REFERENCES));
  });

  it.each([
    [[], '`architecture-design`, `testing`'],
    [['api-contract-design'], '`architecture-design`, `api-contract-design`, `testing`'],
    [
      ['data-model-design', 'api-contract-design'],
      '`architecture-design`, `api-contract-design`, `data-model-design`, `testing`',
    ],
  ])('renders the design skills with %j chosen', (extra, expected) => {
    const { files } = renderSetupFiles(
      testScan(),
      selection({
        addSkills: [...REQUIRED, ...extra],
        orchestrators: ['implementation-orchestrator'],
      }),
    );

    expect(content(files, '.agents/skills/implementation-orchestrator/SKILL.md')).toContain(
      `Load the design skills the change involves (${expected}).`,
    );
  });

  it('renders a reused description with a newline and a pipe as one table row', () => {
    const scan = testScan({
      skills: [{ name: 'legacy-rules', description: 'One\nTwo | three', location: 'agents' }],
    });

    const { files } = renderSetupFiles(
      scan,
      selection({ reuseSkills: ['legacy-rules'], orchestrators: ['plan-orchestrator'] }),
    );

    expect(content(files, '.agents/skills/plan-orchestrator/SKILL.md')).toContain(
      '| `.agents/skills/legacy-rules/SKILL.md` | One Two \\| three |\n',
    );
  });

  it.each([
    ['the required skills', selection()],
    ['every skill and orchestrator', selection({ addSkills: ALL, orchestrators: ORCHESTRATORS })],
  ])('resolves every relative link in %s inside the rendered set', (_, chosen) => {
    expect(unresolvedLinks(renderSetupFiles(testScan(), chosen).files)).toEqual([]);
  });
});

describe('template skills', () => {
  const { files } = renderSetupFiles(testScan(), selection({ addSkills: ALL }));
  const SLOTS: Record<string, string[]> = {
    'project-stack': [
      'fact context',
      'fact stack',
      'fact layout',
      'fact commands',
      'fact conventions',
    ],
    'architecture-design': ['fact layout-and-placement', 'fact import-rules', 'rule pure-core'],
    testing: ['fact test-layers', 'fact test-commands', 'rule per-area', 'rule fakes'],
    'code-quality': ['fact static-checks', 'fact standards', 'rule language-rules'],
    debugging: ['fact reproduce-by-layer'],
    security: ['fact system-context', 'fact trust-boundaries', 'rule untrusted-inputs'],
    performance: ['fact load-model', 'fact hot-paths'],
    'data-model-design': ['fact database-and-orm', 'fact migration-commands', 'rule schema-rules'],
    'api-contract-design': ['fact contract-technology', 'rule error-shape', 'rule pagination'],
  };

  it.each(Object.entries(SLOTS))('%s holds exactly its slots', (name, expected) => {
    const lines = content(files, `.agents/skills/${name}/SKILL.md`).split('\n');
    const slotLines = lines.filter((line) => line.includes('<!-- slot:'));

    expect(slotLines.every((line) => SLOT_LINE_PATTERN.test(line))).toBe(true);
    expect(
      slotLines
        .map((line) => /^<!-- slot: (\w+ [a-z0-9-]+):/.exec(line)?.[1] ?? '')
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(expected.toSorted((a, b) => a.localeCompare(b)));
  });
});

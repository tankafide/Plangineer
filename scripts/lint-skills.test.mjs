import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractRoutedSkills,
  extractSection,
  lintSkills,
  main,
  parseFrontmatter,
} from './lint-skills.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORCHESTRATORS = [
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
];
const RULE = 'Work inline by default.';

async function put(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function orchestratorText(
  name,
  {
    rule = RULE,
    routing = '`.agents/skills/alpha/SKILL.md`',
    link = '[ref](../orchestrator-references/execution.md)',
  } = {},
) {
  return `---\nname: ${name}\ndescription: d\n---\n\n${link}\n\n## Delegation rule\n\n${rule}\n\n## Routing\n\n${routing}\n`;
}

function ruleText(name, hidden = true) {
  return `---\nname: ${name}\ndescription: d\n${hidden ? 'disable-model-invocation: true\n' : ''}---\n\nStub.\n`;
}

function policyText(value) {
  return `interface:\n  display_name: "A"\npolicy:\n  allow_implicit_invocation: ${value}\n`;
}

describe('parseFrontmatter', () => {
  it('returns the data and the body', () => {
    const { data, body } = parseFrontmatter(
      '---\nname: a\ndisable-model-invocation: true\n---\nBody\n',
    );
    expect(data).toEqual({ name: 'a', 'disable-model-invocation': true });
    expect(body).toBe('Body\n');
  });

  it('accepts CRLF input', () => {
    const { data, body } = parseFrontmatter('---\r\nname: a\r\n---\r\nBody\r\n');
    expect(data.name).toBe('a');
    expect(body).toBe('Body\n');
  });

  it('throws when there is no frontmatter', () => {
    expect(() => parseFrontmatter('Body\n')).toThrow('missing frontmatter');
  });
});

describe('extractSection', () => {
  const markdown = '# Title\n\n## One\n\nfirst\n\n### Sub\n\nnested\n\n## Two\n\nsecond\n';

  it('returns the text up to the next level-two heading, keeping subsections', () => {
    expect(extractSection(markdown, 'One')).toBe('first\n\n### Sub\n\nnested');
  });

  it('runs to the end of the file for the last section', () => {
    expect(extractSection(markdown, 'Two')).toBe('second');
  });

  it('returns null when the heading is absent', () => {
    expect(extractSection(markdown, 'Three')).toBeNull();
  });

  it('accepts CRLF input', () => {
    expect(extractSection('## One\r\nfirst\r\n## Two\r\n', 'One')).toBe('first');
  });
});

describe('extractRoutedSkills', () => {
  it('returns each skill named by a SKILL.md path, once', () => {
    const section = [
      '| `.agents/skills/tech-stack/SKILL.md` | always |',
      '| `.agents/skills/testing/SKILL.md` | tests |',
      'Again `.agents/skills/testing/SKILL.md`, and `pnpm verify`.',
    ].join('\n');
    expect(extractRoutedSkills(section)).toEqual(['tech-stack', 'testing']);
  });

  it('ignores names that are not paths', () => {
    expect(extractRoutedSkills('`testing` and `skills/testing/SKILL.md`')).toEqual([]);
  });
});

describe('lintSkills on a temporary skills folder', () => {
  let root;
  const skill = (...parts) => path.join(root, '.agents', 'skills', ...parts);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'lint-skills-'));
    for (const name of ORCHESTRATORS) await put(skill(name, 'SKILL.md'), orchestratorText(name));
    await put(skill('orchestrator-references', 'execution.md'), '# Execution\n');
    await put(skill('alpha', 'SKILL.md'), ruleText('alpha'));
    await put(skill('alpha', 'agents', 'openai.yaml'), policyText('false'));
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('exits 1 from main when the runner lint finds a problem', async () => {
    await rm(skill('alpha', 'agents'), { recursive: true });
    expect(await main(root)).toBe(1);
  });

  it('exits 1 from main for a skill with a broken link', async () => {
    await put(
      skill('alpha', 'SKILL.md'),
      `${ruleText('alpha')}
[gone](../gone/SKILL.md)
`,
    );
    expect(await main(root)).toBe(1);
  });

  it('exits 1 from main for an orchestrator routing a missing skill', async () => {
    await put(
      skill('plan-orchestrator', 'SKILL.md'),
      orchestratorText('plan-orchestrator', { routing: '`.agents/skills/ghost/SKILL.md`' }),
    );
    expect(await main(root)).toBe(1);
  });

  it('exits 0 from main for a valid folder', async () => {
    expect(await main(root)).toBe(0);
  });

  it('passes a valid folder', async () => {
    expect(await lintSkills(root)).toEqual([]);
  });

  it('passes a folder written with CRLF line endings', async () => {
    for (const name of ORCHESTRATORS) {
      await put(skill(name, 'SKILL.md'), orchestratorText(name).replaceAll('\n', '\r\n'));
    }
    expect(await lintSkills(root)).toEqual([]);
  });

  it('fails a missing orchestrator', async () => {
    await rm(skill('plan-review-orchestrator'), { recursive: true });
    expect(await lintSkills(root)).toEqual(['plan-review-orchestrator: skill folder is missing']);
  });

  it('fails delegation rules that differ', async () => {
    await put(
      skill('plan-review-orchestrator', 'SKILL.md'),
      orchestratorText('plan-review-orchestrator', { rule: `${RULE} Changed.` }),
    );
    expect(await lintSkills(root)).toEqual([
      'plan-review-orchestrator: "## Delegation rule" differs from plan-orchestrator',
    ]);
  });

  it('fails an orchestrator with no delegation rule section', async () => {
    const text = orchestratorText('plan-orchestrator').replace('## Delegation rule', '## Other');
    await put(skill('plan-orchestrator', 'SKILL.md'), text);
    expect(await lintSkills(root)).toEqual([
      'plan-orchestrator: missing a "## Delegation rule" section',
    ]);
  });

  it('fails an orchestrator with no routing section', async () => {
    const text = orchestratorText('plan-orchestrator').replace('## Routing', '## Other');
    await put(skill('plan-orchestrator', 'SKILL.md'), text);
    expect(await lintSkills(root)).toEqual(['plan-orchestrator: missing a "## Routing" section']);
  });

  it('fails a routing entry with no SKILL.md', async () => {
    await put(
      skill('plan-orchestrator', 'SKILL.md'),
      orchestratorText('plan-orchestrator', { routing: '`.agents/skills/ghost/SKILL.md`' }),
    );
    expect(await lintSkills(root)).toEqual([
      'plan-orchestrator: routing names ghost, which has no SKILL.md',
    ]);
  });

  it('fails an orchestrator-references folder that has a SKILL.md', async () => {
    await put(skill('orchestrator-references', 'SKILL.md'), ruleText('orchestrator-references'));
    expect(await lintSkills(root)).toEqual(['orchestrator-references: must not have a SKILL.md']);
  });
});

describe('the real skills folder', () => {
  const skills = path.join(REPO_ROOT, '.agents', 'skills');

  it('has no lint problems', async () => {
    expect(await lintSkills(REPO_ROOT)).toEqual([]);
  });

  it('exits 0 from main', async () => {
    expect(await main(REPO_ROOT)).toBe(0);
  });

  it('has no SKILL.md in orchestrator-references, so neither CLI lists it', async () => {
    const exists = await stat(path.join(skills, 'orchestrator-references', 'SKILL.md')).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);
  });
});

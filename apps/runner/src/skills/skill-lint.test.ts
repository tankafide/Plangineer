import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintSkill, lintSkills } from './skill-lint.ts';

const POLICY = 'interface:\n  display_name: A\npolicy:\n  allow_implicit_invocation: false\n';

function ruleSkill(name: string, extra: { frontmatter?: string; body?: string } = {}): string {
  return [
    '---',
    `name: ${name}`,
    'description: What it covers.',
    'disable-model-invocation: true',
    ...(extra.frontmatter === undefined ? [] : [extra.frontmatter]),
    '---',
    '',
    `# ${name}`,
    '',
    extra.body ?? 'See [testing](../testing/SKILL.md).',
    '',
  ].join('\n');
}

describe('lintSkill', () => {
  let root: string;
  const skills = () => path.join(root, '.agents', 'skills');

  async function put(file: string, content: string): Promise<void> {
    const target = path.join(skills(), ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  const lint = (name: string, linkRoot = skills()) => lintSkill(skills(), name, linkRoot);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'skill-lint-'));
    await put('testing/SKILL.md', ruleSkill('testing', { body: 'Tests.' }));
    await put('testing/agents/openai.yaml', POLICY);
  });

  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

  it('reports nothing for a valid rule skill', async () => {
    await put('alpha/SKILL.md', ruleSkill('alpha'));
    await put('alpha/agents/openai.yaml', POLICY);

    expect(await lint('alpha')).toEqual([]);
  });

  it.each([
    [
      'a name unlike its folder',
      ruleSkill('beta'),
      ['frontmatter name must equal the folder name'],
    ],
    [
      'an extra frontmatter field',
      ruleSkill('alpha', { frontmatter: 'model: opus' }),
      ['frontmatter has an unknown field: model'],
    ],
    [
      'a description over 1,024 characters',
      ruleSkill('alpha').replace('What it covers.', 'd'.repeat(1_025)),
      ['description is over 1024 characters'],
    ],
    [
      'no disable-model-invocation',
      ruleSkill('alpha').replace('disable-model-invocation: true\n', ''),
      ['frontmatter must set disable-model-invocation: true'],
    ],
    [
      'a broken link',
      ruleSkill('alpha', { body: '[gone](../gone/SKILL.md)' }),
      ['link does not resolve to a file: ../gone/SKILL.md'],
    ],
    [
      '500 lines',
      ruleSkill('alpha', { body: 'line\n'.repeat(491) }),
      ['SKILL.md must be under 500 lines'],
    ],
  ])('reports %s', async (_name, content, problems) => {
    await put('alpha/SKILL.md', content);
    await put('alpha/agents/openai.yaml', POLICY);

    expect(await lint('alpha')).toEqual(problems);
  });

  it('reports a name holding claude', async () => {
    await put('claude-rules/SKILL.md', ruleSkill('claude-rules'));
    await put('claude-rules/agents/openai.yaml', POLICY);

    expect(await lint('claude-rules')).toEqual(['name must not contain claude or anthropic']);
  });

  it('reports a rule skill without agents/openai.yaml', async () => {
    await put('alpha/SKILL.md', ruleSkill('alpha'));

    expect(await lint('alpha')).toEqual(['agents/openai.yaml is missing']);
  });

  it('reports an orchestrator with disable-model-invocation and with agents/openai.yaml', async () => {
    await put('plan-orchestrator/SKILL.md', ruleSkill('plan-orchestrator', { body: 'Plan.' }));
    await put('plan-orchestrator/agents/openai.yaml', POLICY);

    expect(await lint('plan-orchestrator')).toEqual([
      'an orchestrator must not set disable-model-invocation',
      'an orchestrator must not have agents/openai.yaml',
    ]);
  });

  it('reports a link that leaves the link root', async () => {
    await put('alpha/SKILL.md', ruleSkill('alpha', { body: '[docs](../../../README.md)' }));
    await put('alpha/agents/openai.yaml', POLICY);
    await writeFile(path.join(root, 'README.md'), '# Readme');

    expect(await lint('alpha')).toEqual(['link leaves skills: ../../../README.md']);
    expect(await lint('alpha', root)).toEqual([]);
  });

  it('reads a link inside a code span or a fenced block as text', async () => {
    const body = ['Write `[the post](url)` like this.', '', '```md', '[gone](missing.md)', '```'];
    await put('alpha/SKILL.md', ruleSkill('alpha', { body: body.join('\n') }));
    await put('alpha/agents/openai.yaml', POLICY);

    expect(await lint('alpha')).toEqual([]);
  });

  it('lints every skill but the references folder, naming each problem with its path', async () => {
    await put('alpha/SKILL.md', ruleSkill('alpha'));
    await put('orchestrator-references/review-loop.md', '# Loop');

    expect(await lintSkills(root)).toEqual({
      exitCode: 1,
      message: '.agents/skills/alpha: agents/openai.yaml is missing',
    });
  });

  it('passes with exit code 0 when every skill is valid', async () => {
    await put('orchestrator-references/review-loop.md', '# Loop');

    expect(await lintSkills(root)).toEqual({
      exitCode: 0,
      message: 'Skills lint passed: 1 skills.',
    });
  });
});

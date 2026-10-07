import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySync,
  describeDrift,
  gitIndex,
  hasDrift,
  main,
  normalizeContent,
  planSync,
  toDisplayPath,
  workingTree,
} from './sync-skills.mjs';

const FIX = 'edit the file under .agents/skills/, then run pnpm skills:sync';

describe('toDisplayPath', () => {
  it('joins segments with forward slashes', () => {
    expect(toDisplayPath('.claude/skills', 'a', 'SKILL.md')).toBe('.claude/skills/a/SKILL.md');
  });
});

describe('normalizeContent', () => {
  it('converts CRLF to LF in text', () => {
    expect(normalizeContent(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n');
  });

  it('leaves lone CR and multibyte text intact', () => {
    expect(normalizeContent(Buffer.from('a\rb é\n')).toString()).toBe('a\rb é\n');
  });

  it('leaves binary content untouched', () => {
    const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
    expect(normalizeContent(binary).equals(binary)).toBe(true);
  });
});

describe('skills mirror', () => {
  let root;
  const source = (...parts) => path.join(root, '.agents', 'skills', ...parts);
  const mirror = (...parts) => path.join(root, '.claude', 'skills', ...parts);
  const put = async (file, content) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  };
  const exists = (file) => stat(file).then(() => true, () => false);
  const plan = () => planSync(workingTree(root));
  const sync = async () => applySync(root, await plan());

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sync-skills-'));
    await put(source('alpha', 'SKILL.md'), 'alpha\n');
    await put(source('alpha', 'agents', 'openai.yaml'), 'policy: {}\n');
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('creates an exact LF copy, normalizing CRLF sources', async () => {
    await put(source('alpha', 'SKILL.md'), 'alpha\r\nline\r\n');
    await sync();
    expect((await readFile(mirror('alpha', 'SKILL.md'))).toString()).toBe('alpha\nline\n');
    expect(await readFile(mirror('alpha', 'agents', 'openai.yaml'), 'utf8')).toBe('policy: {}\n');
  });

  it('plans no work after a sync', async () => {
    await sync();
    expect(hasDrift(await plan())).toBe(false);
  });

  it('reports a missing mirror file', async () => {
    await sync();
    await rm(mirror('alpha', 'SKILL.md'));
    expect((await plan()).missing).toEqual(['alpha/SKILL.md']);
  });

  it('reports an edited mirror file', async () => {
    await sync();
    await put(mirror('alpha', 'SKILL.md'), 'edited\n');
    expect((await plan()).changed).toEqual(['alpha/SKILL.md']);
  });

  it('reports an added mirror file as stray', async () => {
    await sync();
    await put(mirror('alpha', 'extra.md'), 'x\n');
    expect((await plan()).stray).toEqual(['alpha/extra.md']);
  });

  it('does not treat a line-ending-only difference as drift', async () => {
    await sync();
    await put(mirror('alpha', 'SKILL.md'), 'alpha\r\n');
    expect(hasDrift(await plan())).toBe(false);
  });

  it('removes stray files and their empty directories on sync', async () => {
    await sync();
    await put(mirror('gone', 'nested', 'SKILL.md'), 'x\n');
    await sync();
    expect(await exists(mirror('gone'))).toBe(false);
    expect(await exists(mirror('alpha', 'SKILL.md'))).toBe(true);
  });

  it('restores an edited mirror file on sync', async () => {
    await sync();
    await put(mirror('alpha', 'SKILL.md'), 'edited\n');
    await sync();
    expect(await readFile(mirror('alpha', 'SKILL.md'), 'utf8')).toBe('alpha\n');
  });

  it('names each drifting file and the fix', async () => {
    await sync();
    await put(mirror('alpha', 'SKILL.md'), 'edited\n');
    await put(mirror('alpha', 'extra.md'), 'x\n');
    await rm(mirror('alpha', 'agents', 'openai.yaml'));
    const message = describeDrift(await plan(), FIX);
    expect(message).toContain('changed: .claude/skills/alpha/SKILL.md');
    expect(message).toContain('stray: .claude/skills/alpha/extra.md');
    expect(message).toContain('missing: .claude/skills/alpha/agents/openai.yaml');
    expect(message).toContain(`Fix: ${FIX}`);
  });

  it('fails loudly when the source folder does not exist', async () => {
    await rm(path.join(root, '.agents'), { recursive: true });
    await expect(plan()).rejects.toThrow();
  });

  it('fails loudly when the source folder is empty', async () => {
    await rm(source('alpha'), { recursive: true });
    await expect(plan()).rejects.toThrow('No skill files found in .agents/skills');
  });

  it('refuses a linked folder in the source, naming it', async () => {
    await symlink(source('alpha', 'agents'), source('alpha', 'linked'), 'junction');
    await expect(plan()).rejects.toThrow('.agents/skills/alpha/linked');
  });

  describe('main', () => {
    it('--check exits 1 on drift without writing', async () => {
      expect(await main(root, ['--check'])).toBe(1);
      expect(await exists(mirror('alpha', 'SKILL.md'))).toBe(false);
    });

    it('sync then --check exits 0', async () => {
      expect(await main(root, [])).toBe(0);
      expect(await main(root, ['--check'])).toBe(0);
    });

    it.each([[['--staged']], [['--chek']], [['--check', '--extra']]])(
      'rejects the arguments %j without writing',
      async (args) => {
        expect(await main(root, args)).toBe(1);
        expect(await exists(mirror('alpha', 'SKILL.md'))).toBe(false);
      },
    );
  });

  describe('staged check', () => {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    const stagedPlan = () => planSync(gitIndex(root));

    beforeEach(async () => {
      git('init', '--quiet');
      await sync();
      git('add', '--all');
    });

    it('passes when the index is in sync', async () => {
      expect(hasDrift(await stagedPlan())).toBe(false);
      expect(await main(root, ['--check', '--staged'])).toBe(0);
    });

    it('fails when a source edit is staged without its mirror copy', async () => {
      await put(source('alpha', 'SKILL.md'), 'edited\n');
      await sync();
      git('add', source('alpha', 'SKILL.md'));
      expect((await stagedPlan()).changed).toEqual(['alpha/SKILL.md']);
      expect(await main(root, ['--check', '--staged'])).toBe(1);
    });

    it('passes when only the working tree drifts', async () => {
      await put(mirror('alpha', 'SKILL.md'), 'edited\n');
      expect(hasDrift(await stagedPlan())).toBe(false);
    });

    it('reports staged missing and stray mirror files', async () => {
      git('rm', '--cached', '--quiet', mirror('alpha', 'SKILL.md'));
      await put(mirror('alpha', 'extra.md'), 'x\n');
      git('add', mirror('alpha', 'extra.md'));
      const result = await stagedPlan();
      expect(result.missing).toEqual(['alpha/SKILL.md']);
      expect(result.stray).toEqual(['alpha/extra.md']);
    });

    it('does not treat a staged line-ending-only difference as drift', async () => {
      git('config', 'core.autocrlf', 'false');
      await writeFile(path.join(root, '.gitattributes'), '* -text\n');
      await put(mirror('alpha', 'SKILL.md'), 'alpha\r\n');
      git('add', mirror('alpha', 'SKILL.md'));
      expect(hasDrift(await stagedPlan())).toBe(false);
    });

    it('refuses a staged symlink, naming it', async () => {
      const sha = git('hash-object', '-w', source('alpha', 'SKILL.md'));
      git('update-index', '--add', '--cacheinfo', `120000,${sha},.agents/skills/alpha/link.md`);
      await expect(stagedPlan()).rejects.toThrow('.agents/skills/alpha/link.md');
    });
  });
});

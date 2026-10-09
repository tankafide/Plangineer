import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitIndex, toDisplayPath, workingTree } from './skill-trees.ts';
import {
  applySync,
  checkSkills,
  checkSkillsMirror,
  describeDrift,
  hasDrift,
  normalizeContent,
  planSync,
  syncSkills,
} from './skills-mirror.ts';

const FIX = 'Edit the file under .agents/skills/, then run `npx plangineer-runner skills sync`.';

async function put(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

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
  let root: string;
  const source = (...parts: string[]) => path.join(root, '.agents', 'skills', ...parts);
  const mirror = (...parts: string[]) => path.join(root, '.claude', 'skills', ...parts);
  const plan = () => planSync(workingTree(root));
  const stagedPlan = () => planSync(gitIndex(root));
  const git = async (...args: string[]) => (await execa('git', args, { cwd: root })).stdout;
  const sync = async () => applySync(root, await plan());

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'skills-mirror-'));
    await put(source('alpha', 'SKILL.md'), 'alpha\n');
    await put(source('alpha', 'agents', 'openai.yaml'), 'policy: {}\n');
  });

  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

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

  it('refuses a linked folder in the source, naming it', async () => {
    await symlink(source('alpha', 'agents'), source('alpha', 'linked'), 'junction');
    await expect(plan()).rejects.toThrow('.agents/skills/alpha/linked');
  });

  it('reports a linked folder as drift for a run checkout, naming it', async () => {
    await sync();
    await symlink(source('alpha', 'agents'), source('alpha', 'linked'), 'junction');

    const result = await checkSkillsMirror(root);

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('.agents/skills/alpha/linked'),
    });
  });

  describe('with no source folder', () => {
    beforeEach(() => rm(path.join(root, '.agents'), { recursive: true }));

    it('passes the check when there is no mirror either', async () => {
      expect(await checkSkillsMirror(root)).toEqual({ ok: true });
      expect(await checkSkills(root, { staged: false })).toEqual({
        exitCode: 0,
        message: 'Skills mirror is in sync.',
      });
    });

    it('fails the check naming each mirror file as stray', async () => {
      await put(mirror('alpha', 'SKILL.md'), 'alpha\n');
      await put(mirror('beta', 'SKILL.md'), 'beta\n');
      expect(await checkSkillsMirror(root)).toEqual({
        ok: false,
        message: [
          'stray: .claude/skills/alpha/SKILL.md',
          'stray: .claude/skills/beta/SKILL.md',
          `Fix: ${FIX}`,
        ].join('\n'),
      });
    });

    it('refuses to sync', async () => {
      expect(await syncSkills(root)).toEqual({
        exitCode: 1,
        message: 'No skill files found under .agents/skills.',
      });
    });
  });

  it('passes the check and refuses to sync when the source folder is empty', async () => {
    await rm(source('alpha'), { recursive: true });
    expect(await checkSkillsMirror(root)).toEqual({ ok: true });
    expect((await syncSkills(root)).exitCode).toBe(1);
  });

  it('names at most 20 drifting files, then how many more', async () => {
    for (let index = 0; index < 23; index += 1) {
      await put(mirror(`stray-${String(index).padStart(2, '0')}`, 'SKILL.md'), 'x\n');
    }
    const result = await checkSkillsMirror(root);
    if (result.ok) throw new Error('expected drift');
    const lines = result.message.split('\n');
    expect(lines.filter((line) => line.includes('.claude/skills/'))).toHaveLength(20);
    expect(lines.slice(-2)).toEqual(['and 5 more', `Fix: ${FIX}`]);
  });

  describe('commands', () => {
    it('check fails on drift without writing', async () => {
      expect((await checkSkills(root, { staged: false })).exitCode).toBe(1);
      expect(await exists(mirror('alpha', 'SKILL.md'))).toBe(false);
    });

    it('sync then check passes', async () => {
      expect(await syncSkills(root)).toEqual({
        exitCode: 0,
        message: 'Skills mirror synced: 2 written, 0 removed.',
      });
      expect((await checkSkills(root, { staged: false })).exitCode).toBe(0);
    });
  });

  describe('staged check', () => {
    beforeEach(async () => {
      await git('init', '--quiet');
      await sync();
      await git('add', '--all');
    });

    it('passes when the index is in sync', async () => {
      expect(hasDrift(await stagedPlan())).toBe(false);
      expect(await checkSkills(root, { staged: true })).toEqual({
        exitCode: 0,
        message: 'Staged skills mirror is in sync.',
      });
    });

    it('fails when a source edit is staged without its mirror copy', async () => {
      await put(source('alpha', 'SKILL.md'), 'edited\n');
      await sync();
      await git('add', source('alpha', 'SKILL.md'));
      expect((await stagedPlan()).changed).toEqual(['alpha/SKILL.md']);
      expect(await checkSkills(root, { staged: true })).toEqual({
        exitCode: 1,
        message: [
          'changed: .claude/skills/alpha/SKILL.md',
          'Fix: Edit the file under .agents/skills/, then run `npx plangineer-runner skills sync` and stage .claude/skills/.',
        ].join('\n'),
      });
    });

    it('passes when only the working tree drifts', async () => {
      await put(mirror('alpha', 'SKILL.md'), 'edited\n');
      expect(hasDrift(await stagedPlan())).toBe(false);
    });

    it('reports staged missing and stray mirror files', async () => {
      await git('rm', '--cached', '--quiet', mirror('alpha', 'SKILL.md'));
      await put(mirror('alpha', 'extra.md'), 'x\n');
      await git('add', mirror('alpha', 'extra.md'));
      const result = await stagedPlan();
      expect(result.missing).toEqual(['alpha/SKILL.md']);
      expect(result.stray).toEqual(['alpha/extra.md']);
    });

    it('does not treat a staged line-ending-only difference as drift', async () => {
      await git('config', 'core.autocrlf', 'false');
      await writeFile(path.join(root, '.gitattributes'), '* -text\n');
      await put(mirror('alpha', 'SKILL.md'), 'alpha\r\n');
      await git('add', mirror('alpha', 'SKILL.md'));
      expect(hasDrift(await stagedPlan())).toBe(false);
    });

    it('refuses a staged symlink, naming it', async () => {
      const sha = await git('hash-object', '-w', source('alpha', 'SKILL.md'));
      await git(
        'update-index',
        '--add',
        '--cacheinfo',
        `120000,${sha},.agents/skills/alpha/link.md`,
      );
      await expect(stagedPlan()).rejects.toThrow('.agents/skills/alpha/link.md');
    });
  });
});

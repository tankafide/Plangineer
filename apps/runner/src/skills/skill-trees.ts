import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { git, gitBytes } from '../worktrees/git.ts';

/** A readable set of files: the working tree or the git index. Paths are POSIX-style. */
export interface SkillTree {
  /** Lists the files under `dir`, relative to it and sorted. A missing `dir` lists nothing. */
  list(dir: string): Promise<string[]>;
  read(dir: string, rel: string): Promise<Buffer>;
}

const SYMLINK_MODE = '120000';
const MERGED_STAGE = '0';

/** Orders strings by UTF-16 code unit, so listings sort the same on every system. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toDisplayPath(...segments: string[]): string {
  return path
    .join(...segments)
    .split(path.sep)
    .join('/');
}

/** A skill file that is a link. Skills are copied, never linked, on every system. */
export class SkillSymlinkError extends Error {
  constructor(file: string) {
    super(`Symlinks are not allowed in skills: ${file}`);
    this.name = 'SkillSymlinkError';
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function collectFiles(root: string, relDir: string, files: string[]): Promise<void> {
  const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    const stats = await lstat(path.join(root, rel));
    if (stats.isSymbolicLink()) throw new SkillSymlinkError(toDisplayPath(root, rel));
    if (stats.isDirectory()) await collectFiles(root, rel, files);
    else files.push(rel);
  }
}

export function workingTree(rootDir: string): SkillTree {
  return {
    async list(dir) {
      const files: string[] = [];
      try {
        await collectFiles(path.join(rootDir, dir), '', files);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      return files.toSorted(compareText);
    },
    read: (dir, rel) => readFile(path.join(rootDir, dir, rel)),
  };
}

interface IndexEntry {
  mode: string;
  sha: string;
  stage: string;
  file: string;
}

function parseIndexEntries(output: string): IndexEntry[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [meta = '', file = ''] = entry.split('\t');
      const [mode = '', sha = '', stage = ''] = meta.split(' ');
      return { mode, sha, stage, file };
    });
}

function parseBlobBatch(output: Buffer, count: number): Buffer[] {
  const blobs: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const headerEnd = output.indexOf(0x0a, offset);
    const size = Number(output.subarray(offset, headerEnd).toString().split(' ')[2]);
    blobs.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
    offset = headerEnd + 1 + size + 1;
  }
  return blobs;
}

export function gitIndex(rootDir: string): SkillTree {
  const contents = new Map<string, Buffer>();
  return {
    async list(dir) {
      const listing = await git(rootDir, ['ls-files', '--stage', '-z', '--', dir]);
      const entries = parseIndexEntries(listing);
      for (const entry of entries) {
        if (entry.mode === SYMLINK_MODE) throw new SkillSymlinkError(entry.file);
        if (entry.stage !== MERGED_STAGE) throw new Error(`Unmerged file in skills: ${entry.file}`);
      }
      if (entries.length === 0) return [];
      const input = entries.map((entry) => `${entry.sha}\n`).join('');
      const blobs = parseBlobBatch(
        await gitBytes(rootDir, ['cat-file', '--batch'], input),
        entries.length,
      );
      entries.forEach((entry, index) => {
        const blob = blobs[index];
        if (blob === undefined) throw new Error(`git cat-file returned no blob for ${entry.file}`);
        contents.set(entry.file, blob);
      });
      return entries.map((entry) => entry.file.slice(dir.length + 1)).toSorted(compareText);
    },
    async read(dir, rel) {
      const blob = contents.get(`${dir}/${rel}`);
      if (blob === undefined) throw new Error(`${dir}/${rel} is not in the git index listing`);
      return blob;
    },
  };
}

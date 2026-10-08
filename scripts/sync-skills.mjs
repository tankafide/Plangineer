import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

const SOURCE_DIR = '.agents/skills';
const MIRROR_DIR = '.claude/skills';
const FIX = `edit the file under ${SOURCE_DIR}/, then run pnpm skills:sync`;
const STAGED_FIX = `${FIX} and stage ${MIRROR_DIR}/`;
const USAGE = 'Usage: node scripts/sync-skills.mjs [--check [--staged]]';
const SYMLINK_MODE = '120000';
const MERGED_STAGE = '0';

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeContent(content) {
  if (content.includes(0)) return content;
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

export function toDisplayPath(...segments) {
  return path
    .join(...segments)
    .split(path.sep)
    .join('/');
}

function symlinkError(file) {
  return new Error(`Symlinks are not allowed in skills: ${file}`);
}

export function workingTree(rootDir) {
  return {
    async list(dir) {
      const files = [];
      await collectFiles(path.join(rootDir, dir), '', files);
      return files.toSorted(compareText);
    },
    read: (dir, rel) => readFile(path.join(rootDir, dir, rel)),
  };
}

async function collectFiles(root, relDir, files) {
  const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    const stats = await lstat(path.join(root, rel));
    if (stats.isSymbolicLink()) throw symlinkError(toDisplayPath(root, rel));
    if (stats.isDirectory()) await collectFiles(root, rel, files);
    else files.push(rel);
  }
}

function git(rootDir, args, input) {
  const result = spawnSync('git', args, { cwd: rootDir, input, maxBuffer: 1024 ** 3 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
}

function parseIndexEntries(output) {
  return output
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [meta, file] = entry.split('\t');
      const [mode, sha, stage] = meta.split(' ');
      return { mode, sha, stage, file };
    });
}

function parseBlobBatch(output, count) {
  const blobs = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const headerEnd = output.indexOf(0x0a, offset);
    const size = Number(output.subarray(offset, headerEnd).toString().split(' ')[2]);
    blobs.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
    offset = headerEnd + 1 + size + 1;
  }
  return blobs;
}

export function gitIndex(rootDir) {
  const contents = new Map();
  return {
    async list(dir) {
      const entries = parseIndexEntries(git(rootDir, ['ls-files', '--stage', '-z', '--', dir]));
      for (const entry of entries) {
        if (entry.mode === SYMLINK_MODE) throw symlinkError(entry.file);
        if (entry.stage !== MERGED_STAGE) throw new Error(`Unmerged file in skills: ${entry.file}`);
      }
      if (entries.length === 0) return [];
      const input = entries.map((entry) => `${entry.sha}\n`).join('');
      const blobs = parseBlobBatch(git(rootDir, ['cat-file', '--batch'], input), entries.length);
      entries.forEach((entry, index) => contents.set(entry.file, blobs[index]));
      return entries.map((entry) => entry.file.slice(dir.length + 1)).toSorted(compareText);
    },
    read: async (dir, rel) => contents.get(`${dir}/${rel}`),
  };
}

export async function planSync(tree) {
  const sourceFiles = await tree.list(SOURCE_DIR);
  if (sourceFiles.length === 0) throw new Error(`No skill files found in ${SOURCE_DIR}`);
  const mirrorFiles = await tree.list(MIRROR_DIR).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const sourceSet = new Set(sourceFiles);
  const mirrorSet = new Set(mirrorFiles);
  const missing = [];
  const changed = [];
  const contents = new Map();

  for (const rel of sourceFiles) {
    const expected = normalizeContent(await tree.read(SOURCE_DIR, rel));
    contents.set(rel, expected);
    if (!mirrorSet.has(rel)) {
      missing.push(rel);
      continue;
    }
    const actual = normalizeContent(await tree.read(MIRROR_DIR, rel));
    if (!expected.equals(actual)) changed.push(rel);
  }
  const stray = mirrorFiles.filter((rel) => !sourceSet.has(rel));
  return { missing, changed, stray, contents };
}

export function hasDrift(plan) {
  return plan.missing.length + plan.changed.length + plan.stray.length > 0;
}

export function describeDrift(plan, fix) {
  const lines = [
    ...plan.missing.map((rel) => `missing: ${toDisplayPath(MIRROR_DIR, rel)}`),
    ...plan.changed.map((rel) => `changed: ${toDisplayPath(MIRROR_DIR, rel)}`),
    ...plan.stray.map((rel) => `stray: ${toDisplayPath(MIRROR_DIR, rel)}`),
  ];
  return [...lines, `Fix: ${fix}`].join('\n');
}

export async function applySync(rootDir, plan) {
  const mirrorRoot = path.join(rootDir, MIRROR_DIR);
  for (const rel of [...plan.missing, ...plan.changed]) {
    const target = path.join(mirrorRoot, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, plan.contents.get(rel));
  }
  for (const rel of plan.stray) {
    await rm(path.join(mirrorRoot, rel));
    await removeEmptyParents(mirrorRoot, path.dirname(path.join(mirrorRoot, rel)));
  }
}

async function removeEmptyParents(stopDir, dir) {
  if (path.relative(stopDir, dir) === '') return;
  if ((await readdir(dir)).length > 0) return;
  await rmdir(dir);
  await removeEmptyParents(stopDir, path.dirname(dir));
}

function parseArgs(args) {
  const check = args.includes('--check');
  const staged = args.includes('--staged');
  const unknown = args.filter((arg) => arg !== '--check' && arg !== '--staged');
  if (unknown.length > 0 || (staged && !check)) return null;
  return { check, staged };
}

export async function main(rootDir, args) {
  const options = parseArgs(args);
  if (options === null) {
    console.error(USAGE);
    return 1;
  }
  if (options.check) {
    const tree = options.staged ? gitIndex(rootDir) : workingTree(rootDir);
    const plan = await planSync(tree);
    if (hasDrift(plan)) {
      console.error(describeDrift(plan, options.staged ? STAGED_FIX : FIX));
      return 1;
    }
    console.log(options.staged ? 'Staged skills mirror is in sync.' : 'Skills mirror is in sync.');
    return 0;
  }
  const plan = await planSync(workingTree(rootDir));
  await applySync(rootDir, plan);
  const written = plan.missing.length + plan.changed.length;
  console.log(`Skills mirror synced: ${written} written, ${plan.stray.length} removed.`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(repoRoot, process.argv.slice(2));
}

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchPostgres, postgresArchive } from './fetch-postgres.mjs';

/** A gzipped tar shaped like the theseus-rs archives: one top folder holding bin/. */
async function fixtureArchive(root) {
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'postgresql-18.6.0', 'bin'), { recursive: true });
  await writeFile(path.join(source, 'postgresql-18.6.0', 'bin', 'initdb'), 'initdb binary');
  await writeFile(path.join(source, 'postgresql-18.6.0', 'PG_VERSION_INFO'), '18.6.0');
  const file = path.join(root, 'archive.tar.gz');
  tar.create({ gzip: true, file, cwd: source, sync: true }, ['postgresql-18.6.0']);
  const bytes = await readFile(file);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function serve(bytes) {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => response.end(bytes));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('postgresArchive', () => {
  it.each([
    ['win32', 'x64', 'x86_64-pc-windows-msvc', '7da44c2d'],
    ['darwin', 'arm64', 'aarch64-apple-darwin', 'a257bcdb'],
    ['darwin', 'x64', 'x86_64-apple-darwin', 'f8918fbe'],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', 'bb3d09f8'],
  ])('pins the %s %s archive', (platform, arch, triple, hashStart) => {
    const archive = postgresArchive(platform, arch);
    expect(archive.url).toBe(
      `https://github.com/theseus-rs/postgresql-binaries/releases/download/18.6.0/postgresql-18.6.0-${triple}.tar.gz`,
    );
    expect(archive.sha256.startsWith(hashStart)).toBe(true);
  });

  it('refuses a target with no pinned archive', () => {
    expect(() => postgresArchive('linux', 'arm64')).toThrow(
      'No Postgres binaries are pinned for linux arm64',
    );
  });
});

describe('fetchPostgres', () => {
  let root;
  let server;
  let url;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fetch-postgres-'));
  });

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function serveFixture() {
    const fixture = await fixtureArchive(root);
    server = await serve(fixture.bytes);
    url = `http://127.0.0.1:${server.address().port}/postgresql.tar.gz`;
    return fixture;
  }

  it('extracts bin/initdb without the archive top folder', async () => {
    const { sha256 } = await serveFixture();
    const destination = path.join(root, 'stage', 'postgres');

    await fetchPostgres({ url, sha256 }, destination);

    expect(await readFile(path.join(destination, 'bin', 'initdb'), 'utf8')).toBe('initdb binary');
    expect(await readdir(path.join(root, 'stage'))).toEqual(['postgres']);
  });

  it('fails on a hash mismatch, deleting the download and extracting nothing', async () => {
    await serveFixture();
    const destination = path.join(root, 'stage', 'postgres');

    await expect(fetchPostgres({ url, sha256: '0'.repeat(64) }, destination)).rejects.toThrow(
      `but ${'0'.repeat(64)} is pinned`,
    );
    expect(await readdir(path.join(root, 'stage'))).toEqual([]);
  });
});

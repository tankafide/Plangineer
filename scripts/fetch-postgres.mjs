import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import * as tar from 'tar';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

const POSTGRES_VERSION = '18.6.0';
const RELEASES = 'https://github.com/theseus-rs/postgresql-binaries/releases/download';

/** The pinned archive per platform and arch, from the desktop app plan. */
const TARGETS = {
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
    sha256: '7da44c2dbcda3b49688ea08ce8cf99cfe677adf565f53a9145bf9002c74db7d5',
  },
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    sha256: 'a257bcdb8aa3301a13d6a5bcec48f8c9517045b7cbae71e50788b2615539e95b',
  },
  'darwin-x64': {
    triple: 'x86_64-apple-darwin',
    sha256: 'f8918fbe747e0d79bda58ad8f8afcf23ac384b847ff3af18856f0825ba54b031',
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    sha256: 'bb3d09f876b2383e25a8c9ce09e32d185a03656a23d074f5195542b1b1b3ca61',
  },
};

export const POSTGRES_STAGE_DIR = path.join(repoRoot, 'apps', 'desktop', 'stage', 'postgres');

/** The archive URL and its SHA-256 for a platform and arch the desktop app ships. */
export function postgresArchive(platform, arch) {
  const target = TARGETS[`${platform}-${arch}`];
  if (target === undefined) {
    throw new Error(`No Postgres binaries are pinned for ${platform} ${arch}`);
  }
  return {
    url: `${RELEASES}/${POSTGRES_VERSION}/postgresql-${POSTGRES_VERSION}-${target.triple}.tar.gz`,
    sha256: target.sha256,
  };
}

/** Streams the download to a file while hashing it, and returns the hex SHA-256. */
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Downloading ${url} answered ${response.status}`);
  }
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), hashing, createWriteStream(file));
  return hash.digest('hex');
}

/**
 * Downloads a Postgres archive, checks its SHA-256 and extracts it into destination without its
 * top folder. A hash mismatch deletes the download and extracts nothing.
 */
export async function fetchPostgres({ url, sha256 }, destination) {
  await rm(destination, { recursive: true, force: true, maxRetries: 5 });
  await mkdir(path.dirname(destination), { recursive: true });
  const archive = `${destination}.tar.gz`;
  try {
    const actual = await download(url, archive);
    if (actual !== sha256) {
      throw new Error(`${url} has SHA-256 ${actual}, but ${sha256} is pinned`);
    }
    await mkdir(destination);
    await tar.extract({ file: archive, cwd: destination, strip: 1 });
  } finally {
    await rm(archive, { force: true, maxRetries: 5 });
  }
}

if (isEntryPoint(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        platform: { type: 'string', default: process.platform },
        arch: { type: 'string', default: process.arch },
      },
    });
    await fetchPostgres(postgresArchive(values.platform, values.arch), POSTGRES_STAGE_DIR);
    console.log(`Extracted Postgres ${POSTGRES_VERSION} into apps/desktop/stage/postgres`);
  } catch (error) {
    reportFailure(error);
  }
}

import { execa } from 'execa';
import { isEntryPoint, reportFailure } from './script-entry.mjs';

/** The assets a desktop release must hold, named as electron-builder.yml sets them. */
function expectedAssets(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (match === null) throw new Error(`${tag} is not a tag of the form v<major>.<minor>.<patch>`);
  const version = match[1];
  return [
    `Plangineer-Setup-${version}.exe`,
    `Plangineer-${version}-arm64.dmg`,
    `Plangineer-${version}-x64.dmg`,
    `Plangineer-${version}.AppImage`,
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
  ];
}

/** The expected assets a release with these asset names lacks. */
export function missingAssets(tag, assetNames) {
  const present = new Set(assetNames);
  return expectedAssets(tag).filter((name) => !present.has(name));
}

/** Reads the release's assets with gh and fails naming each missing one. */
async function checkRelease(tag) {
  const { stdout } = await execa('gh', ['release', 'view', tag, '--json', 'assets']);
  const { assets } = JSON.parse(stdout);
  const missing = missingAssets(
    tag,
    assets.map((asset) => asset.name),
  );
  if (missing.length > 0) {
    throw new Error(`Release ${tag} is missing: ${missing.join(', ')}`);
  }
  console.log(`Release ${tag} holds every installer and update file.`);
}

if (isEntryPoint(import.meta.url)) {
  try {
    const tag = process.argv[2];
    if (tag === undefined) throw new Error('Usage: node scripts/release-assets.mjs v<version>');
    await checkRelease(tag);
  } catch (error) {
    reportFailure(error);
  }
}

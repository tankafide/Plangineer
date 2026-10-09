import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reportFailure, repoRoot } from './script-entry.mjs';

const BUILD_DIR = path.join(repoRoot, 'apps', 'desktop', 'build');
const ICONS = [
  { file: 'icon.png', size: 1024 },
  { file: 'tray-icon.png', size: 16 },
  { file: 'tray-icon@2x.png', size: 32 },
];

/** Playwright is a dependency of apps/web, so it resolves from there. It is CommonJS. */
async function importPlaywright() {
  const require = createRequire(path.join(repoRoot, 'apps', 'web', 'package.json'));
  return import(pathToFileURL(require.resolve('@playwright/test')).href);
}

/** Renders apps/desktop/build/icon.svg to the PNGs the app and its tray use. */
async function main() {
  const svg = await readFile(path.join(BUILD_DIR, 'icon.svg'), 'utf8');
  const { chromium } = (await importPlaywright()).default;
  const browser = await chromium.launch();
  try {
    for (const { file, size } of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const sized = svg.replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`);
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
      );
      await page.screenshot({ path: path.join(BUILD_DIR, file), omitBackground: true });
      await page.close();
      console.log(`Wrote apps/desktop/build/${file}`);
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  reportFailure(error);
}

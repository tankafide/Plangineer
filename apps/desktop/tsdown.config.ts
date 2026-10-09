import { defineConfig } from 'tsdown';

/**
 * Builds the Electron main process into `dist/main.mjs`. Every dependency is bundled except
 * `electron`, which the runtime provides, so the packaged app ships no node_modules. The startup
 * page and tray icons are copied beside it, since electron-builder packs only `dist/`.
 */
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  deps: { alwaysBundle: (id) => id !== 'electron', neverBundle: ['electron'], onlyBundle: false },
  copy: ['src/startup.html', 'build/tray-icon.png', 'build/tray-icon@2x.png'],
});

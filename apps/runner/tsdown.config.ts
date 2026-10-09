import { defineConfig } from 'tsdown';

/**
 * Builds the published CLI, which the desktop app also runs. Every dependency is bundled, so the
 * package has no dependencies and `dist/` runs with no node_modules.
 */
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  deps: { alwaysBundle: () => true, onlyBundle: false },
});

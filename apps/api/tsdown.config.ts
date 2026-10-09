import { defineConfig } from 'tsdown';

/**
 * Builds the server bundles the desktop app ships. Every dependency is bundled, so `dist/` runs
 * with no node_modules. pg requires pg-native only when it is installed, so it stays external.
 */
export default defineConfig({
  entry: { main: 'src/main.ts', migrate: 'src/db/migrate-cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  deps: { alwaysBundle: (id) => id !== 'pg-native', neverBundle: ['pg-native'], onlyBundle: false },
});

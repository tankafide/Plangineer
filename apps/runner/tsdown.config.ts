import { defineConfig } from 'tsdown';

/**
 * Builds the published CLI. Node strips no types under node_modules, so the package ships
 * JavaScript, with the workspace contracts bundled in and every npm dependency left external.
 */
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  deps: { alwaysBundle: ['@plangineer/contracts'] },
});

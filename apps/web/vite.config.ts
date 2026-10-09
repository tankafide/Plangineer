import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { readApiPort } from './api-port.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ command, mode }) => ({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('src', import.meta.url)) },
  },
  // Only the dev server proxies to the API, so a build needs no .env.
  ...(command === 'serve' && { server: devServer(mode) }),
}));

function devServer(mode: string) {
  const apiUrl = `http://localhost:${readApiPort(loadEnv(mode, REPO_ROOT, ''))}`;
  return {
    port: 5173,
    strictPort: true,
    // ws: true carries the runner socket, so runners pair and connect through the web origin.
    proxy: { '/api': { target: apiUrl, ws: true }, '/rpc': apiUrl },
  };
}

import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const API_PREFIXES = ['/api/', '/rpc/'];

function isApiPath(requestPath: string): boolean {
  return API_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
}

/**
 * Serves the built web app from webDistDir on the API's origin. Register it after every API
 * route. A GET outside /api/ and /rpc/ that matches no file gets index.html, so the router in
 * the page handles the path.
 *
 * Hashed files under /assets/ never change, so browsers keep them. Every other file, index.html
 * above all, is checked on each load, so an updated app never loads a page that names deleted
 * assets. serveStatic builds its response before its onFound hook runs, so the header is set
 * first.
 */
export function registerWebAssets<E extends object>(app: Hono<E>, webDistDir: string): void {
  const files = serveStatic({ root: webDistDir });
  const indexPage = serveStatic({ root: webDistDir, path: 'index.html' });
  app.get('*', (c, next) => {
    if (isApiPath(c.req.path)) return next();
    c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
    return files(c, next);
  });
  app.get('*', (c, next) => {
    if (isApiPath(c.req.path)) return next();
    c.header('Cache-Control', 'no-cache');
    return indexPage(c, next);
  });
}

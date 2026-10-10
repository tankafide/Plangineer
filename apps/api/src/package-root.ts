import { fileURLToPath } from 'node:url';

/**
 * The folder that holds `drizzle/`, `src/setup/templates/` and `src/features/templates/`:
 * `apps/api/` from source, and the server folder above `dist/` from the bundle.
 */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

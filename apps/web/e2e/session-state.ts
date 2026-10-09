import { fileURLToPath } from 'node:url';

/** The signed-in storage state global-setup.ts writes, for journeys that need a session. */
export const SESSION_STATE = fileURLToPath(new URL('.auth/session.json', import.meta.url));

/** The stored GitHub App's client ID global-setup.ts writes, as `{ "clientId": ... }`. */
export const E2E_APP_STATE = fileURLToPath(new URL('.auth/github-app.json', import.meta.url));

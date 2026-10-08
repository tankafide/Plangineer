import { fileURLToPath } from 'node:url';

/** The signed-in storage state global-setup.ts writes, for journeys that need a session. */
export const SESSION_STATE = fileURLToPath(new URL('.auth/session.json', import.meta.url));

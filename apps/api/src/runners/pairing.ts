import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a code reads back without confusion. */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUPS = 3;
const GROUP_LENGTH = 4;
const TOKEN_BYTES = 32;

/** A user may create this many pairing codes per window. */
export const PAIRING_CODE_LIMIT = 5;
export const PAIRING_CODE_WINDOW_MS = 10 * 60 * 1000;

/** Twelve random Crockford characters in three dashed groups, such as 7K2M-QX9D-4TNA. */
export function generatePairingCode(): string {
  return Array.from({ length: CODE_GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => CROCKFORD_ALPHABET[randomInt(32)]).join(''),
  ).join('-');
}

/** The form a code is hashed in: dashes removed, uppercased. */
export function normalizePairingCode(code: string): string {
  return code.replaceAll('-', '').toUpperCase();
}

export function generateRunnerToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex. Enough for random secrets, which need no salt or stretching. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

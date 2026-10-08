import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a code reads back without confusion. */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUPS = 3;
const GROUP_LENGTH = 4;
const SECRET_BYTES = 32;

/** Twelve random Crockford characters in three dashed groups, such as 7K2M-QX9D-4TNA. */
export function generateUserCode(): string {
  return Array.from({ length: CODE_GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => CROCKFORD_ALPHABET[randomInt(32)]).join(''),
  ).join('-');
}

/** The form a user code is hashed in: dashes removed, uppercased. */
export function normalizeUserCode(userCode: string): string {
  return userCode.replaceAll('-', '').toUpperCase();
}

/** The secret only the runner holds, which its poll trades for the token. */
export function generateDeviceSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export function generateRunnerToken(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** SHA-256 hex. Enough for random secrets, which need no salt or stretching. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

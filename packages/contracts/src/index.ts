import { meGet } from './me.ts';

export { MeGetOutput, UserRole } from './me.ts';

export const contract = { me: { get: meGet } };

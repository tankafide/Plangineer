import { z } from 'zod';
import { base } from './base.ts';

export const UserRole = z.enum(['admin', 'member']);
export type UserRole = z.infer<typeof UserRole>;

export const MeGetOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: UserRole,
});
export type MeGetOutput = z.infer<typeof MeGetOutput>;

export const meGet = base.route({ method: 'GET', path: '/me' }).output(MeGetOutput);

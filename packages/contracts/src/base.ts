import { oc } from '@orpc/contract';
import { z } from 'zod';

export const base = oc.errors({
  UNAUTHORIZED: { status: 401 },
  FORBIDDEN: { status: 403 },
  INPUT_VALIDATION_FAILED: {
    status: 422,
    data: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }),
  },
});

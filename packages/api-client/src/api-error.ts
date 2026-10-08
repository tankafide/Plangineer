import { ORPCError } from '@orpc/client';

/** A code the contract defines on a procedure, such as NOT_FOUND on run.get. */
type ApiErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'TOO_MANY_REQUESTS';

/** Whether a hook's error is the contract-defined error with this code. */
export function isApiError(error: unknown, code: ApiErrorCode): boolean {
  return error instanceof ORPCError && error.defined && error.code === code;
}

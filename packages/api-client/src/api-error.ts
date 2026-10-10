import { ORPCError } from '@orpc/client';
import { InvalidSelectionData } from '@plangineer/contracts';

/** A code the contract defines on a procedure, such as NOT_FOUND on run.get. */
type ApiErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'TOO_MANY_REQUESTS' | 'RUNNER_REQUIRED';

/** Whether a hook's error is the contract-defined error with this code. */
export function isApiError(error: unknown, code: ApiErrorCode): boolean {
  return error instanceof ORPCError && error.defined && error.code === code;
}

/** The data of a start refused with INVALID_SELECTION, or null for any other error. */
export function invalidSelectionData(error: unknown): InvalidSelectionData | null {
  if (!(error instanceof ORPCError && error.defined && error.code === 'INVALID_SELECTION')) {
    return null;
  }
  return InvalidSelectionData.parse(error.data);
}

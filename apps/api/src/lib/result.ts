/**
 * The outcome of an operation that can fail in an expected way, named by an error code. A
 * failure may carry the data its contract error defines.
 */
export type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; data?: unknown };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const fail = <E extends string>(error: E): { ok: false; error: E } => ({ ok: false, error });

/** A failure with the data its contract error carries, such as GitHub's status and message. */
export const err = <E extends string>(
  error: E,
  data: unknown,
): { ok: false; error: E; data: unknown } => ({ ok: false, error, data });

/** The outcome of an operation that can fail in an expected way, named by an error code. */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const fail = <E extends string>(error: E): { ok: false; error: E } => ({ ok: false, error });

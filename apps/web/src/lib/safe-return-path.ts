/**
 * The path to return to after sign-in, or `/` when `value` is not a same-origin path. A
 * same-origin path starts with `/`, holds no backslash or control character, and resolves to
 * `origin`, which rules out `//host` and `/\host`.
 */
export function safeReturnPath(value: string, origin: string): string {
  if (!value.startsWith('/') || value.includes('\\') || /\p{Cc}/u.test(value)) return '/';
  return new URL(value, origin).origin === origin ? value : '/';
}

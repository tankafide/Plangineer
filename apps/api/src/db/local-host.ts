const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True only when the database URL points at this machine. */
export function isLocalDatabaseUrl(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

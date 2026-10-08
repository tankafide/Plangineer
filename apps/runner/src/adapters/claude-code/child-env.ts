/** What Claude Code needs to run: the system, home, temp, locale and proxy variables. */
const ALLOWED_NAMES = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'COMSPEC',
  'WINDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
]);

/** Locale settings and Claude Code's own documented configuration, which may hold its API key. */
const ALLOWED_PREFIXES = ['LC_', 'ANTHROPIC_', 'CLAUDE_'];

function isAllowed(name: string): boolean {
  const upper = name.toUpperCase();
  return ALLOWED_NAMES.has(upper) || ALLOWED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * The agent child's whole environment: only allowlisted names from `source`, matched
 * case-insensitively so Windows `Path` keeps its key. Values pass through unread, and nothing of
 * the runner's own, such as `PLANGINEER_*`, reaches the child.
 */
export function childEnv(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && isAllowed(name)) env[name] = value;
  }
  return env;
}

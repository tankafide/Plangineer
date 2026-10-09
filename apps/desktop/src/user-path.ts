/** Reads the login shell's environment, as `shell-env` does. */
export type ReadShellEnv = () => Promise<Readonly<Record<string, string>>>;

/**
 * The `PATH` the runner gets. An app opened from the dock or menu on macOS and Linux gets a
 * minimal `PATH` without `~/.local/bin` or Homebrew, so it comes from the login shell. On
 * Windows the desktop's own `Path` is right, so the runner gets it unchanged and this returns
 * no override.
 */
export async function runnerPathOverride(
  platform: NodeJS.Platform,
  readShellEnv: ReadShellEnv,
): Promise<Record<string, string>> {
  if (platform === 'win32') return {};
  const { PATH } = await readShellEnv();
  if (PATH === undefined || PATH === '') throw new Error('The login shell has no PATH');
  return { PATH };
}

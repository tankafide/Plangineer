/** Where sign-in, the GitHub App's creation and its install happen, so it stays in the window. */
const GITHUB_ORIGIN = 'https://github.com';

export type NavigationDecision = 'allow' | 'external' | 'refuse';

/**
 * The app origin and GitHub stay in the window, any other `http` or `https` URL opens in the
 * default browser, and every other scheme is refused.
 */
export function decideNavigation(url: string, appOrigin: string): NavigationDecision {
  if (!URL.canParse(url)) return 'refuse';
  const parsed = new URL(url);
  if (parsed.origin === new URL(appOrigin).origin || parsed.origin === GITHUB_ORIGIN) {
    return 'allow';
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? 'external' : 'refuse';
}

interface PreventableEvent {
  preventDefault(): void;
}

/** The part of Electron's `WebContents` the policy guards. */
export interface GuardedContents {
  on(event: 'will-navigate', listener: (event: PreventableEvent, url: string) => void): unknown;
  on(event: 'will-redirect', listener: (event: PreventableEvent, url: string) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

/**
 * Applies the policy to every navigation, redirect and new window. A new window is always
 * denied: an allowed URL loads in the one window instead.
 */
export function guardNavigation(
  contents: GuardedContents,
  appOrigin: string,
  openExternal: (url: string) => Promise<void>,
  loadInWindow: (url: string) => void,
): void {
  function blockUnlessAllowed(event: PreventableEvent, url: string): void {
    const decision = decideNavigation(url, appOrigin);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') void openExternal(url);
  }
  contents.on('will-navigate', blockUnlessAllowed);
  contents.on('will-redirect', blockUnlessAllowed);
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, appOrigin);
    if (decision === 'allow') loadInWindow(url);
    else if (decision === 'external') void openExternal(url);
    return { action: 'deny' };
  });
}

/** The part of Electron's `Session` that grants web permissions. */
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
}

/** Denies every permission, since the window also loads `https://github.com`. */
export function denyAllPermissions(session: PermissionSession): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

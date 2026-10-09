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
 * Applies the policy to every navigation and redirect. A new window is always denied, and an
 * `http` or `https` one opens in the default browser: GitHub's sign-in, App creation and install
 * are same-window flows, and a page such as the App's settings would otherwise replace the app
 * with no way back.
 */
export function guardNavigation(
  contents: GuardedContents,
  appOrigin: string,
  openExternal: (url: string) => Promise<void>,
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
    if (decideNavigation(url, appOrigin) !== 'refuse') void openExternal(url);
    return { action: 'deny' };
  });
}

/** The part of Electron's `Session` that grants web permissions. */
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: { requestingUrl?: string },
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
}

/** What the app's own copy buttons need. Chromium asks only the request handler for it. */
const CLIPBOARD_WRITE = 'clipboard-sanitized-write';

function isFrom(url: string | undefined, origin: string | undefined): boolean {
  return (
    url !== undefined && origin !== undefined && URL.canParse(url) && new URL(url).origin === origin
  );
}

/**
 * Denies every permission, since the window also loads `https://github.com`, except a clipboard
 * write the app's own pages request. `appOrigin` is read per request, because the origin is
 * known only once the stack has started.
 */
export function restrictPermissions(
  session: PermissionSession,
  appOrigin: () => string | undefined,
): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(permission === CLIPBOARD_WRITE && isFrom(details.requestingUrl, appOrigin())),
  );
  session.setPermissionCheckHandler(() => false);
}

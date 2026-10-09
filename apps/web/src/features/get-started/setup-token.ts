const SETUP_TOKEN_KEY = 'plangineer.setupToken';
const FRAGMENT_KEY = 'setup-token';

/**
 * Moves a `#setup-token=<value>` fragment into sessionStorage and removes it from the URL, so the
 * token is neither in the address bar nor in the history. A fragment never reaches a server.
 */
export function captureSetupToken(): void {
  const token = new URLSearchParams(window.location.hash.slice(1)).get(FRAGMENT_KEY);
  if (token === null) return;
  sessionStorage.setItem(SETUP_TOKEN_KEY, token);
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

/** The setup token this tab was opened with, or null. */
export function readSetupToken(): string | null {
  return sessionStorage.getItem(SETUP_TOKEN_KEY);
}

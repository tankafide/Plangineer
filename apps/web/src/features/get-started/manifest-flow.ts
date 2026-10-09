const MANIFEST_STATE_KEY = 'plangineer.manifestState';
const MANIFEST_STATE_BYTES = 16;

function base64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Posts the GitHub App manifest to GitHub, which leaves this page. A random state goes with it and
 * is kept in sessionStorage, so the redirect back can be matched to this setup.
 */
export function postManifest({ postUrl, manifest }: { postUrl: string; manifest: string }): void {
  const state = base64url(crypto.getRandomValues(new Uint8Array(MANIFEST_STATE_BYTES)));
  sessionStorage.setItem(MANIFEST_STATE_KEY, state);
  const action = new URL(postUrl);
  action.searchParams.set('state', state);
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action.href;
  form.hidden = true;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = manifest;
  form.append(field);
  document.body.append(form);
  form.submit();
}

/** Whether GitHub's redirect carries the state this setup posted. */
export function isManifestState(state: string): boolean {
  return sessionStorage.getItem(MANIFEST_STATE_KEY) === state;
}

export function clearManifestState(): void {
  sessionStorage.removeItem(MANIFEST_STATE_KEY);
}

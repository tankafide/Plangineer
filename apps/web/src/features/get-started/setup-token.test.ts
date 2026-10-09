import { afterEach, describe, expect, it } from 'vitest';
import { captureSetupToken, readSetupToken } from './setup-token';

const TOKEN = 'Zm9vYmFyLWJhei1xdXV4LXNldHVwLXRva2VuLTQzY2g';

function openAt(url: string) {
  window.history.replaceState(null, '', url);
}

afterEach(() => {
  sessionStorage.clear();
  openAt('/');
});

describe('captureSetupToken', () => {
  it('stores the token from the fragment and removes the fragment from the URL', () => {
    openAt(`/get-started?code=abc#setup-token=${TOKEN}`);

    captureSetupToken();

    expect(sessionStorage.getItem('plangineer.setupToken')).toBe(TOKEN);
    expect(readSetupToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/get-started');
    expect(window.location.search).toBe('?code=abc');
  });

  it('keeps the stored token when the URL has no fragment', () => {
    sessionStorage.setItem('plangineer.setupToken', TOKEN);
    openAt('/get-started');

    captureSetupToken();

    expect(readSetupToken()).toBe(TOKEN);
  });

  it('leaves another fragment in place', () => {
    openAt('/get-started#top');

    captureSetupToken();

    expect(readSetupToken()).toBeNull();
    expect(window.location.hash).toBe('#top');
  });
});

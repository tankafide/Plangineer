import { describe, expect, it } from 'vitest';
import {
  decideNavigation,
  type GuardedContents,
  guardNavigation,
  type PermissionSession,
  restrictPermissions,
} from './navigation-policy.ts';

const APP_ORIGIN = 'http://127.0.0.1:47100';

type Listener = (event: { preventDefault(): void }, url: string) => void;

/** Web contents that record the policy's handlers, and the URLs it opens or loads. */
function fakeContents() {
  const listeners = new Map<string, Listener>();
  let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
  const contents: GuardedContents = {
    on: (event: string, listener: Listener) => listeners.set(event, listener),
    setWindowOpenHandler: (handler) => {
      openHandler = handler;
    },
  };
  const external: string[] = [];
  guardNavigation(contents, APP_ORIGIN, async (url) => {
    external.push(url);
  });

  function navigate(event: 'will-navigate' | 'will-redirect', url: string): boolean {
    let prevented = false;
    listeners.get(event)?.({ preventDefault: () => (prevented = true) }, url);
    return prevented;
  }
  function openWindow(url: string) {
    if (openHandler === undefined) throw new Error('No window open handler');
    return openHandler({ url });
  }
  return { navigate, openWindow, external };
}

describe('decideNavigation', () => {
  it.each([
    ['http://127.0.0.1:47100/get-started#setup-token=abc', 'allow'],
    ['http://127.0.0.1:47100/api/auth/callback/github?code=1', 'allow'],
    ['https://github.com/settings/apps/new', 'allow'],
    ['https://github.com/login/oauth/authorize?client_id=1', 'allow'],
    ['http://127.0.0.1:47101/', 'external'],
    ['http://localhost:47100/', 'external'],
    ['https://github.com.evil.example/', 'external'],
    ['https://docs.github.com/en', 'external'],
    ['http://github.com/', 'external'],
    ['https://example.com/', 'external'],
    ['file:///etc/passwd', 'refuse'],
    ['javascript:alert(1)', 'refuse'],
    ['mailto:someone@example.com', 'refuse'],
    ['not a url', 'refuse'],
  ])('%s is %s', (url, decision) => {
    expect(decideNavigation(url, APP_ORIGIN)).toBe(decision);
  });
});

describe('guardNavigation', () => {
  it.each(['will-navigate', 'will-redirect'] as const)(
    'keeps the app and GitHub in the window on %s',
    (event) => {
      const contents = fakeContents();

      expect(contents.navigate(event, `${APP_ORIGIN}/repositories`)).toBe(false);
      expect(contents.navigate(event, 'https://github.com/login')).toBe(false);
      expect(contents.external).toEqual([]);
    },
  );

  it.each(['will-navigate', 'will-redirect'] as const)(
    'sends another web URL to the default browser on %s',
    (event) => {
      const contents = fakeContents();

      expect(contents.navigate(event, 'https://example.com/docs')).toBe(true);
      expect(contents.external).toEqual(['https://example.com/docs']);
    },
  );

  it.each(['file:///etc/passwd', 'javascript:alert(1)'])('refuses %s', (url) => {
    const contents = fakeContents();

    expect(contents.navigate('will-navigate', url)).toBe(true);
    expect(contents.openWindow(url)).toEqual({ action: 'deny' });
    expect(contents.external).toEqual([]);
  });

  it('denies every new window, opening an http or https one in the default browser', () => {
    const contents = fakeContents();

    expect(contents.openWindow('https://github.com/apps/plangineer')).toEqual({ action: 'deny' });
    expect(contents.openWindow(`${APP_ORIGIN}/runs`)).toEqual({ action: 'deny' });
    expect(contents.openWindow('https://example.com/')).toEqual({ action: 'deny' });

    expect(contents.external).toEqual([
      'https://github.com/apps/plangineer',
      `${APP_ORIGIN}/runs`,
      'https://example.com/',
    ]);
  });
});

type RequestHandler = Parameters<PermissionSession['setPermissionRequestHandler']>[0];
type CheckHandler = Parameters<PermissionSession['setPermissionCheckHandler']>[0];

function handlers(appOrigin: string | undefined) {
  const found: { request?: RequestHandler; check?: CheckHandler } = {};
  restrictPermissions(
    {
      setPermissionRequestHandler: (handler) => (found.request = handler),
      setPermissionCheckHandler: (handler) => (found.check = handler),
    },
    () => appOrigin,
  );
  return found;
}

function request(appOrigin: string | undefined, permission: string, requestingUrl: string) {
  const granted: boolean[] = [];
  handlers(appOrigin).request?.(undefined, permission, (answer) => granted.push(answer), {
    requestingUrl,
  });
  return granted;
}

describe('restrictPermissions', () => {
  it.each(['media', 'notifications', 'geolocation', 'clipboard-read', 'openExternal'])(
    'denies a %s request and check, even from the app',
    (permission) => {
      expect(request(APP_ORIGIN, permission, `${APP_ORIGIN}/runners`)).toEqual([false]);
      expect(handlers(APP_ORIGIN).check?.(undefined, permission)).toBe(false);
    },
  );

  it('grants a clipboard write the app requests, so its copy buttons work', () => {
    expect(request(APP_ORIGIN, 'clipboard-sanitized-write', `${APP_ORIGIN}/runners`)).toEqual([
      true,
    ]);
  });

  it.each([
    ['GitHub', APP_ORIGIN, 'https://github.com/settings/apps'],
    ['any page before the stack starts', undefined, `${APP_ORIGIN}/runners`],
  ])('denies a clipboard write from %s', (_, appOrigin, requestingUrl) => {
    expect(request(appOrigin, 'clipboard-sanitized-write', requestingUrl)).toEqual([false]);
  });
});

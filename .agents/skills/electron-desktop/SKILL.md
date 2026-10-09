---
name: electron-desktop
description: The Electron desktop app in apps/desktop, which runs the API, Postgres and runner on the engineer's machine. Covers window security and navigation, utilityProcess children, the start and stop order, quit, tray, login items, packaging and updates, and its tests. Use when planning, implementing or reviewing code in apps/desktop.
disable-model-invocation: true
---

# Electron desktop

Rules for `apps/desktop`, the Electron 44 main process. The [desktop app plan](../../../docs/plans/2026-10-08-desktop-app.md) holds the design. The shell is thin: it starts Postgres, the API and the runner, opens a window on the API's origin, and talks to the API over HTTP as the signed-in user. It imports only `contracts`. Paths, spawning and data folders follow [cross-platform](../cross-platform/SKILL.md). The runner's own rules are in [runner-adapters](../runner-adapters/SKILL.md).

## Implement mode

### Shape

| Part | Rule |
| --- | --- |
| Logic | No server or business logic, no preload, no IPC, no `webview`. A feature the window needs goes in `apps/api` and `apps/web` |
| Electron APIs | Only `main.ts` imports `electron` or `electron-updater`. Every other module takes the Electron objects it uses as parameters, so unit tests pass fakes |
| Build | tsdown bundles everything except `electron` into `dist/main.mjs`. Every dependency is a `devDependency`, and `dependencies` stays empty |
| Resources | Bundles and binaries come from `process.resourcesPath` when `app.isPackaged`, else `apps/desktop/stage/`. They ship as `extraResources`, never inside `app.asar`, since Postgres and the API read real files on disk |

### Window

- One `BrowserWindow` on the partition `persist:plangineer`. Keep `contextIsolation`, `sandbox` and `webSecurity` on and `nodeIntegration` off. Never set `allowRunningInsecureContent`, `experimentalFeatures` or `enableBlinkFeatures`.
- The partition's `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything.
- `will-navigate`, `will-redirect` and `setWindowOpenHandler` all call one navigation policy. It parses the URL with `new URL` and compares `origin` exactly, never with `startsWith`. The app origin and `https://github.com` stay in the window. Any other `http` or `https` URL goes to `shell.openExternal`. Every other scheme is refused.
- `setWindowOpenHandler` always returns `{ action: 'deny' }`. An allowed URL loads in the one window.
- A secret in a URL goes in the fragment, never the query, so no server log records it.
- Closing the window hides it, and the stack keeps running from the tray. The `close` handler hides only until `before-quit` fires.
- `app.requestSingleInstanceLock()` before anything starts. A second launch shows the existing window and exits.

### Local stack

- `startStack` runs a fixed order and stops at the first failure: write `server.env`, start Postgres, migrate, start the API, then poll `/api/auth/ok`. `stopStack` stops the runner, the API, then Postgres. A failure shows a native dialog naming the step, with **Retry**, **Open logs folder** and **Quit**.
- Node children (the migrate bundle, the API, the runner) run with `utilityProcess.fork`. It takes a whole environment, so `node-process.ts` alone merges one from `process.env`. This is the one exception to the `cross-platform` environment rule.
- Native binaries such as `pg_ctl` run with execa.
- The API listens on `127.0.0.1` and Postgres on its default `localhost`, loopback only. Check a port is free before a child binds it, and name the port and `server.env` in the error.
- Postgres stops with `pg_ctl stop -m fast -w -t 30`. The API and runner stop with `taskkill /pid <pid> /T /F` on Windows, else `SIGTERM` to the pid only, since a `utilityProcess` child cannot be detached. `SIGKILL` follows after 10 s for the API and 20 s for the runner. The runner's grace exceeds its own `STOP_GRACE_MS`, so it stops its agents first. Wait for `exit`.
- Assume any stop can be skipped. Windows shutdown does not fire `before-quit`, so each start handles a Postgres still running from its data folder.
- Child output goes to `desktop.log`. The Postgres password, setup token and runner token never reach a log.
- The desktop never reads the runner's files. It acts on `start --server` exit codes and `login --json` events.

### Quit, tray and login item

- `before-quit` calls `event.preventDefault()` synchronously while the stack runs, awaits `stopStack()`, then calls `app.quit()` again. A flag stops that loop. Electron never awaits an async handler.
- `autoUpdater.quitAndInstall()` runs only after `stopStack()` resolves.
- The tray holds every action, so nothing needs the window.
- The login item uses `app.setLoginItemSettings` on Windows, a LaunchAgent plist on macOS and an autostart `.desktop` file on Linux, each passing `--hidden`. `setLoginItemSettings` fails silently for an unsigned macOS app. On Linux, `Exec` uses `process.env.APPIMAGE`, never `process.execPath`, which points into a temporary mount.

### Packaging and updates

- electron-builder builds NSIS per user on Windows, `dmg` plus `zip` per arch on macOS and AppImage on Linux. The macOS `zip` exists for `latest-mac.yml`. Never set `asar: false`.
- Builds are unsigned, except macOS keeps an ad-hoc signature (`identity: "-"`, `hardenedRuntime: false`), which Apple silicon requires. Never `identity: null`.
- electron-updater reads the GitHub `publish` config. Never call `setFeedURL`. Set `autoUpdater.logger` to the desktop logger.
- macOS cannot update an unsigned app in place, so `autoDownload` is off there, and a found update adds a tray item that opens the release page. Windows and Linux download, then install on quit.
- The version lives in `apps/desktop/package.json`, and its tag is `v<version>`.

### Tests

| Layer | How |
| --- | --- |
| Unit | Vitest with fake Electron objects passed in. Cover the navigation policy, permission handlers, stop branches per system, quit ordering and the update choice per system |
| Stack | `*.stack.test.ts`, run by `test:stack`, against the real Postgres binaries and the built bundles. Temp folders and free ports, never 47100, 47101 or the person's data. `child_process.fork` stands in for `utilityProcess` |
| Packaged | Playwright `_electron.launch` on the packaged Linux app under `xvfb-run`, with `XDG_*` set to temp folders. `electronApp.evaluate` reaches main-process state. A fuse that turns off `nodeCliInspect` breaks `_electron.launch`, so a plan that adds fuses says how this layer runs |

## Review mode

Raise findings with source skill `electron-desktop`, in the [finding format](../orchestrator-references/finding-format.md).

| Rule | Severity if broken |
| --- | --- |
| `nodeIntegration` on, `contextIsolation`, `sandbox` or `webSecurity` off, a preload, IPC or `webview` added | blocker |
| A permission granted, or a navigation allowed outside the app origin and `https://github.com` | blocker |
| `setWindowOpenHandler` returning `allow`, or `will-navigate` or `will-redirect` with no handler | blocker |
| `shell.openExternal` with a URL not checked as `http` or `https`, or an origin compared with `startsWith` | blocker |
| Postgres or the API listening beyond loopback | blocker |
| A secret in a log or a URL query | blocker |
| `apps/desktop` imports anything but `contracts`, or holds server or business logic | blocker |
| An async `before-quit` without `preventDefault`, or `quitAndInstall` before `stopStack` resolves | should fix |
| A `close` handler that blocks quit or `quitAndInstall` | should fix |
| A stop that leaves a Postgres, API or runner process behind | should fix |
| A resource read from inside `app.asar`, or a path that differs between packaged and unpackaged without `app.isPackaged` | should fix |
| macOS `identity: null`, or updates downloaded on macOS | should fix |
| An environment object built outside `node-process.ts` | should fix |
| `electron` or `electron-updater` imported outside `main.ts`, so a module cannot be unit tested | should fix |
| A runtime `dependencies` entry in `apps/desktop/package.json` | should fix |
| A stack test that uses fixed ports or the person's data folders | should fix |

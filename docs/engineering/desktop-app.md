# Desktop app

The Plangineer desktop app runs the API, the web app, Postgres 18 and the runner on your own computer, listening only on `127.0.0.1`. It needs no Node, Docker or terminal. This guide covers installing it, the first run, where it keeps its files, and the changes you make by hand. The design is in the [desktop app plan](../plans/2026-10-08-desktop-app.md).

## Install

Download the installer for your system from the [latest release](https://github.com/tankafide/Plangineer/releases/latest). The installers are unsigned, so each system warns you once.

| System | Installer | Install | First open |
| --- | --- | --- | --- |
| Windows x64 | `.exe` | Run it. It installs for your user only, with no admin prompt | SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway** |
| macOS | `.dmg`, `arm64` for Apple silicon, `x64` for Intel | Drag Plangineer into Applications. Opened from anywhere else, the app offers to move itself there | macOS says it cannot verify Plangineer. Click **Done**, open System Settings > Privacy & Security, click **Open Anyway** beside the Plangineer message, then confirm with your password |
| Linux x64 | `.AppImage` | Save it where you keep apps. After moving it, open it once from its new place, so **Open at login** follows | Allow it to run: in the file manager's Properties, turn on **Allow executing file as program**, or run `chmod +x` on it |

## First run

On first open the app creates its database and its settings, then opens the **Get started** screen. The steps below hold the only clicks GitHub, Claude Code and the first sign-in need from you.

1. Open Plangineer. A window shows "Starting Plangineer" while Postgres, the migrations and the API start.
2. **Create the GitHub App.** Click **Create GitHub App**. GitHub opens in the window. Sign in to GitHub if it asks, then click **Create GitHub App for `<your account>`**. GitHub returns you to **Get started** with step 1 done. The App belongs to your personal GitHub account.
3. **Sign in.** Click **Sign in with GitHub**, then **Authorize** on GitHub. The first person to sign in becomes the admin. A macOS passkey is not offered in the window, so use your password, an authenticator app, GitHub Mobile or a security key.
4. **Claude Code.** The app pairs its own runner with your account, with no code to copy. When Claude Code is missing, the step links to its install page. Install it, run `claude` once in a terminal to sign in, then quit Plangineer from its tray icon and open it again. The runner reads your `PATH` when Plangineer starts, so it finds a new install only after that restart. It then checks for Claude Code every 30 seconds, and the step turns done.
5. **Add a repository.** Click **Add repository**, then **Install on GitHub**. Pick the repositories Plangineer may read and click **Install**. GitHub returns you to the Repositories screen, where you choose a repository and add it.
6. Click **Open Plangineer**.

## In the background

Closing the window hides it, and the API, Postgres and runner keep running. **Open at login** turns on after the first successful start, and the app then starts at login with no window. The tray icon holds every action:

| Tray item | Does |
| --- | --- |
| **Open Plangineer** | Shows the window. On macOS, clicking the dock icon does the same |
| **Open at login** | Starts the app hidden when you log in. Turn it off here |
| **Check for updates** | Checks GitHub Releases now. The app also checks at start and every 6 hours |
| **Open logs folder** | Opens the logs folder |
| **Quit Plangineer** | Stops the runner, the API and Postgres, then quits |

## Updates

| System | How an update arrives |
| --- | --- |
| Windows and Linux | Downloads in the background. The tray then shows **Restart to update to `<version>`**, and the update also installs the next time you quit |
| macOS | An unsigned app cannot replace itself. The tray shows **Download Plangineer `<version>`**, which opens the release page. Download the `.dmg`, drag the app over the old one in Applications, and pass the warning as on the first open if macOS shows it |

## Where it keeps its files

The app writes to three folders, named for your system:

| Folder | Windows | macOS | Linux |
| --- | --- | --- | --- |
| `<config>` | `%APPDATA%\Plangineer\Config` | `~/Library/Preferences/Plangineer` | `$XDG_CONFIG_HOME/Plangineer`, by default `~/.config/Plangineer` |
| `<data>` | `%LOCALAPPDATA%\Plangineer\Data` | `~/Library/Application Support/Plangineer` | `$XDG_DATA_HOME/Plangineer`, by default `~/.local/share/Plangineer` |
| `<log>` | `%LOCALAPPDATA%\Plangineer\Log` | `~/Library/Logs/Plangineer` | `$XDG_STATE_HOME/Plangineer`, by default `~/.local/state/Plangineer` |
| `<resources>`, the installed app | `%LOCALAPPDATA%\Programs\Plangineer\resources` | `/Applications/Plangineer.app/Contents/Resources` | Inside the `.AppImage` |

| What | Where |
| --- | --- |
| Server settings | `<config>/server.env`, readable only by you on macOS and Linux |
| Postgres data | `<data>/postgres` |
| Runner data, with its pairing and worktrees | `<data>/runner` |
| Logs | `<log>/api.log`, `<log>/postgres.log`, `<log>/desktop.log` |
| API, migrations and runner | `<resources>/server/dist/main.mjs`, `<resources>/server/dist/migrate.mjs`, `<resources>/runner/dist/cli.mjs` |
| Web app | `<resources>/web` |
| Postgres binaries | `<resources>/postgres/bin` |

`server.env` holds the database password, `BETTER_AUTH_SECRET` and the setup token, so keep it private. The app writes it on the first start and never rewrites a value. A release that adds a setting appends it with its default. `BETTER_AUTH_SECRET` encrypts the stored GitHub App, so changing it stops the next start with `The stored GitHub App cannot be decrypted. BETTER_AUTH_SECRET changed since the App was created.`

## Change a port

The API listens on port 47100 and Postgres on 47101. When another program holds one, the start fails with `Port <n> is in use by another program`. To move Plangineer to another port:

1. Quit Plangineer from the tray.
2. Open `<config>/server.env` in a text editor.
3. For the API, set `API_PORT` and the port in `BETTER_AUTH_URL` to the same new number. For Postgres, change the port after `127.0.0.1:` in `DATABASE_URL`.
4. After an API port change, open your App on GitHub under Settings > Developer settings > GitHub Apps > `plangineer-<id>` > **Edit**. Set the port in **Callback URL**, `http://127.0.0.1:<port>/api/auth/callback/github`, and in **Setup URL**, `http://127.0.0.1:<port>/repositories`, then click **Save changes**.
5. Open Plangineer. The runner finds its pairing points at the old address, and the app pairs it again by itself.

A Postgres port change needs no change on GitHub.

## Move to a team server

A team server runs the same API from the same database, and moving to one is a Postgres dump and restore. The container image and deploy guide for a team server are not built yet. To dump the desktop database with the `pg_dump` the app ships:

1. Leave Plangineer running, so its Postgres is up.
2. Copy the `DATABASE_URL` value from `<config>/server.env`.
3. Run `<resources>/postgres/bin/pg_dump` (`pg_dump.exe` on Windows) with `--format=custom --file plangineer.dump "<DATABASE_URL>"`. On Linux, first run the `.AppImage` with `--appimage-extract`, which writes the app's files to `squashfs-root/`, and use `squashfs-root/resources/postgres/bin/pg_dump`.
4. On the team server's Postgres 18, run `pg_restore --no-owner --dbname "<team DATABASE_URL>" plangineer.dump`.
5. Give the team server the same `BETTER_AUTH_SECRET`, so it can decrypt the stored GitHub App. Set the App's **Callback URL** and **Setup URL** on GitHub to the team server's origin, as in step 4 of [Change a port](#change-a-port).
6. Pair each runner with the team server: `npx plangineer-runner login --server <team server URL>`.

## Webhooks

GitHub delivers webhooks only to a public URL, and the desktop app listens only on `127.0.0.1`. The GitHub App's webhook stays inactive. A later feature that needs GitHub events does not work from the desktop app without a tunnel.

## When something fails

| What you see | What it means |
| --- | --- |
| A dialog naming a start step, with **Retry**, **Open logs folder** and **Quit** | That step of the start failed. The message names the cause, and the logs folder holds the detail |
| `The database was created by Postgres <n>. This version of Plangineer runs Postgres 18.` | The data folder comes from another Postgres major version, which this app cannot upgrade |
| `This computer's runner could not be paired: <message>` | Pairing failed three times in a row. **Retry** starts again |
| `This computer's runner keeps stopping: <message>` | The runner exited with an error five times in a row. `desktop.log` holds its output |

# Plangineer

Plangineer is a desktop app for Windows, macOS and Linux that takes a feature from a reviewed plan to verified code. Engineers write and review plans, and agents implement, review and test against the plan and the repository's skills. The agents run through the Claude Code CLI on the engineer's own computer.

## Install

Download the installer for your system from the [latest release](https://github.com/tankafide/Plangineer/releases/latest): `.exe` for Windows, `.dmg` for macOS on Apple silicon (`arm64`) or Intel (`x64`), and `.AppImage` for Linux. The installers are unsigned. The [desktop app guide](docs/engineering/desktop-app.md) shows how to open them, what the first run asks of you, and where the app keeps its data.

## Developer setup

1. Install Node 24 and Docker Desktop, and start Docker Desktop.
2. Install dependencies: `pnpm install`.
3. Create your `.env`: `pnpm setup:env`.
4. Start Postgres, the API and the web UI on http://localhost:5173: `pnpm dev`.
5. Open the Get started link `pnpm dev` prints, and click **Create GitHub App** to create your dev GitHub App. Sign in with GitHub, click **Add repository**, then **Install on GitHub**, and pick the repositories Plangineer may read. `pnpm db:reset` keeps the App.
6. Check your work: `pnpm verify`, then `pnpm test:e2e` with `pnpm dev` stopped.

Work in a Git worktree beside the checkout, created with `pnpm worktree:new <type>/<slug>`, never by switching branches in it, as the [git workflow](.agents/skills/orchestrator-references/git-workflow.md) describes. The stack, commands and conventions are in [stack decisions](docs/engineering/stack-decisions.md).

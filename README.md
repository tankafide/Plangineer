# Plangineer

Plangineer is a desktop app for Windows, macOS and Linux that takes a feature from a reviewed plan to verified code. Engineers write and review plans, and agents implement, review and test against the plan and the repository's skills. The agents run through the Claude Code CLI on the engineer's own computer.

## Install

The desktop app is planned in the [desktop app plan](docs/plans/2026-10-08-desktop-app.md) and has no release yet. Until it ships, run Plangineer from a developer checkout.

## Developer setup

1. Install Node 24 and Docker Desktop, and start Docker Desktop.
2. Install dependencies: `pnpm install`.
3. Create your `.env`: `pnpm setup:env`.
4. Create your dev GitHub App: `pnpm setup:github-app`. Click "Create GitHub App" on the page it opens. GitHub then opens the App's install page: pick the repositories Plangineer may read, and click "Install". You can change them later from the Repositories screen.
5. Start Postgres, the API and the web UI on http://localhost:5173: `pnpm dev`.
6. Check your work: `pnpm verify`, then `pnpm test:e2e` with `pnpm dev` stopped.

Work in a Git worktree beside the checkout, never by switching branches in it, as the [git workflow](.agents/skills/orchestrator-references/git-workflow.md) describes. The stack, commands and conventions are in [stack decisions](docs/engineering/stack-decisions.md).

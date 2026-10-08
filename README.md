# Plangineer

Plangineer is a web app that takes a feature from a reviewed plan to verified code. Engineers write and review plans, and agents implement, review and test against the plan and the repository's skills.

## Setup

1. Install Node 24 and Docker Desktop, and start Docker Desktop.
2. Install dependencies: `pnpm install`.
3. Create your `.env`: `pnpm setup:env`.
4. Create your dev GitHub App: `pnpm setup:github-app`. Click "Create GitHub App" on the page it opens. GitHub then opens the App's install page: pick the repositories Plangineer may read, and click "Install". You can change them later from the Repositories screen.
5. Start Postgres, the API and the web app on http://localhost:5173: `pnpm dev`.
6. Check your work: `pnpm verify`, then `pnpm test:e2e` with `pnpm dev` stopped.

The stack, commands and conventions are in [stack decisions](docs/engineering/stack-decisions.md).

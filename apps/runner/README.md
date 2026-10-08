# plangineer-runner

The Plangineer runner runs agent jobs from a Plangineer deployment on your machine, with the coding CLI you have installed and signed in to. It also keeps a repository's agent skills in sync between `.agents/skills/` and the `.claude/skills/` mirror.

## Install

Node 24 is required.

```bash
npm install --global plangineer-runner
```

## Commands

| Command | Does |
| --- | --- |
| `plangineer-runner login --server <url> [--name <name>] [--no-browser]` | Pairs this machine with a deployment: opens the approval page in your browser, and finishes when you click **Approve**. `--name` defaults to the machine's host name. `--no-browser` prints the link and does not open it |
| `plangineer-runner start` | Connects to the deployment and runs the jobs it assigns until stopped |
| `plangineer-runner skills sync` | Writes the `.claude/skills/` mirror from `.agents/skills/` |
| `plangineer-runner skills check [--staged]` | Fails on any missing, changed or stray mirror file, writing nothing. `--staged` checks the git index |
| `plangineer-runner skills lint` | Checks each skill under `.agents/skills/` against the skill file rules |
| `plangineer-runner --version` | Prints the runner's version |

Edit skills only under `.agents/skills/`, then run `plangineer-runner skills sync`. In CI, `npx --yes plangineer-runner skills check` fails the build on a drifted mirror.

## Settings

The runner reads these optional variables from its environment.

| Variable | Default |
| --- | --- |
| `PLANGINEER_RUNNER_DATA_DIR` | The user data directory |
| `PLANGINEER_RUNNER_CONCURRENCY` | `2` |
| `PLANGINEER_CLAUDE_COMMAND` | `["claude"]` |
| `PLANGINEER_GIT_BASE_URL` | `https://github.com` |
| `PLANGINEER_RUN_TIMEOUT_MS` | `3600000` |
| `LOG_LEVEL` | `info` |

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
| `plangineer-runner login --server <url> [--name <name>] [--no-browser] [--json]` | Pairs this machine with a deployment: opens the approval page in your browser, and finishes when you click **Approve**. `--name` defaults to the machine's host name. `--no-browser` prints the link and does not open it. `--json` prints one JSON event per line and nothing else, and does not open the browser |
| `plangineer-runner start [--server <url>]` | Connects to the deployment and runs the jobs it assigns until stopped. `--server` stops it with exit code 3 when the runner is paired with another server. While it runs, it checks every 30 seconds whether Claude Code was installed or changed, and reports it |
| `plangineer-runner skills sync` | Writes the `.claude/skills/` mirror from `.agents/skills/` |
| `plangineer-runner skills check [--staged]` | Fails on any missing, changed or stray mirror file, writing nothing. `--staged` checks the git index |
| `plangineer-runner skills lint` | Checks each skill under `.agents/skills/` against the skill file rules |
| `plangineer-runner --version` | Prints the runner's version |

Edit skills only under `.agents/skills/`, then run `plangineer-runner skills sync`. In CI, `npx --yes plangineer-runner skills check` fails the build on a drifted mirror.

### `login --json` events

| Event | Fields | When |
| --- | --- | --- |
| `login_started` | `userCode`, `approveUrl`, `expiresAt` | The login request started |
| `paired` | `runnerId` | `runner.json` is written. Exit code 0 |
| `failed` | `message`, at most 500 characters | The request was denied or expired, or the server failed or could not be reached. Exit code 1 |

### Exit codes

| Code | Means |
| --- | --- |
| `0` | The command succeeded, or `start` stopped on `SIGINT` or `SIGTERM` |
| `1` | The command failed. `start` exits 1 when another process took over its pairing or the server disagrees on the protocol |
| `3` | The runner must be paired: `start` found no `runner.json`, `--server` names another server, or the server refused or revoked its token |

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

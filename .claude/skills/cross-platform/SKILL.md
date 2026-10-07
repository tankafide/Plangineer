---
name: cross-platform
description: Rules that keep code working on Windows, macOS and Linux, covering paths, line endings, filename case, process spawning and stopping, environment variables, file handles and no symlinks. Use when implementing or reviewing code that touches paths, processes, line endings or the file system.
disable-model-invocation: true
---

# Cross-platform

Windows, macOS and Linux are equal targets, and CI runs `pnpm verify` on all three. The dev machine is Windows, so POSIX assumptions surface only in CI, and Windows assumptions surface only if you look for them.

## Implement mode

| Area | Rule |
| --- | --- |
| Paths | Build paths with `node:path`. Convert `import.meta.url` with `fileURLToPath`, and pass an absolute path to dynamic `import()` through `pathToFileURL(...).href`, because `import('C:\\...')` throws on Windows. No hard-coded `/` or `\`, drive letters or `~` |
| Path identity | Store and compare POSIX-style relative paths: in URLs, database rows, snapshots, plan text and git output. Convert to native paths only at the file system boundary. Never compare native path strings without `path.resolve` first |
| App data | The runner keeps its data under `env-paths`. Never build a home or temp path by hand |
| Line endings | LF everywhere, pinned by `.gitattributes` (`* text=auto eol=lf`). Write `\n`, never `os.EOL`. Split input with `/\r?\n/`, and normalize before comparing content, as `scripts/sync-skills.mjs` does |
| Filenames | Kebab-case. An import path matches the file's case exactly, since Windows and macOS ignore case and Linux does not. Rename a file's case with `git mv`. No reserved names (`con`, `nul`, `aux`, `prn`, `com1`), no `:` or trailing dot or space |
| Spawning | Spawn CLIs with `execa`, passing the command and an argument array. Never `node:child_process` for an npm-installed CLI: Node 24 throws `EINVAL` when spawning a `.cmd` shim without a shell, and `execa` handles the shim safely. Never `shell: true` or a command built from a string |
| Stopping | One function stops a run. On macOS and Linux it spawns with `detached: true` and signals the group with `process.kill(-pid)`. On Windows it runs `taskkill /pid <pid> /T /F`. Shutdown handlers listen for `SIGINT` too, since Windows never delivers `SIGTERM` |
| Environment | Read variables through the Zod environment schema. Pass extra child variables through `execa`'s `env`, which extends `process.env`. Never copy `process.env` into a new object, which loses Windows' case-insensitive `Path`. Do not assume `HOME`, `SHELL` or `USER` |
| File handles | Close every handle and wait for a child to exit before deleting or renaming its files, since Windows locks open files. Remove folders with `fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })` |
| Symlinks | None. Copy files instead. Creating one needs extra permission on Windows |
| Scripts | Node scripts only. No bash, PowerShell or `cmd`, no Unix tools such as `rm`, `cp`, `grep` or `sed`, and no reliance on an executable bit or shebang. Run them with `node` |
| Tests | Pass on all three systems. Listen on port `0`, build expected paths with `node:path`, create temp folders with `fs.mkdtemp(path.join(os.tmpdir(), ...))`, and never depend on `\n` versus `\r\n` |

### Pitfalls the Windows dev machine hides

- An import whose case differs from the file passes on Windows and fails on Linux CI.
- Two files that differ only by case cannot both exist on Windows or macOS.
- A Unix socket path, such as the Docker socket, used as the only way to reach a service.
- `/tmp`, `~` or `/home/<user>` literals in code, config or fixtures.

## Review mode

Check a diff against these rules. Report each breach as a finding in the shared [finding format](../orchestrator-references/finding-format.md), with source skill `cross-platform`.

| Rule | Severity if broken |
| --- | --- |
| `shell: true`, a command built from a string, an npm-installed CLI spawned with `node:child_process`, or a bash or PowerShell file | blocker |
| A stop that signals only the child pid, or has no Windows branch | blocker |
| A symlink created, or a test that depends on one | blocker |
| A hand-built path, a hard-coded separator, drive letter or `~`, or a file URL and path mixed without `fileURLToPath` or `pathToFileURL` | should fix |
| A native path stored, sent or compared as an identifier | should fix |
| A parser or comparison that fails on CRLF input, or output written with `os.EOL` | should fix |
| An import whose case differs from the file, two files that differ only by case, or a reserved filename | should fix |
| `process.env` copied into a new object for a child, or `HOME`, `SHELL` or `USER` read directly | should fix |
| A hard-coded port or temp path in a test, or an expectation that holds on one system only | should fix |
| A handle left open or a child still running where a delete or rename follows | should fix |
| Runner data written outside `env-paths` | should fix |
| A filename that is not kebab-case | nit |

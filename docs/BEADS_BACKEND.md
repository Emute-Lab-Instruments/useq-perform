# Beads Dolt Backend

This repository uses the Dolt-backed `bd` backend.

## Chosen Repo Defaults

- Runtime model: server-backed Dolt
- Shared connection defaults: `.beads/config.yaml`
- Local overrides: `.beads/metadata.json` or `BEADS_DOLT_*` environment variables
- Primary issue transport: Dolt, not `sync-branch`
- Git-carried JSONL: retained as an artifact/backup path, not the canonical sync mechanism
- Canonical remote: VPS-hosted Dolt remotes API via local SSH tunnel

The shared defaults currently assume a local Dolt SQL server on `127.0.0.1:3307` using database `beads_useq-perform` and user `root`.

Under `bd 0.59.x`, `.beads/dolt` is the managed Dolt server data directory, not the repository itself. The actual Dolt repository for this project lives at `.beads/dolt/beads_useq-perform`.

## Backend Options

According to the Beads docs and current CLI behavior, the practical choices are:

1. Local-only server-backed Dolt
   Use this when one machine owns the tracker or while the team is still choosing a remote.

2. Dolt-native remote sync
   Configure a real remote/store and use `bd dolt push` / `bd dolt pull`.

3. Protected-branch workflow
   Use a dedicated sync branch only if branch protection requires it. This is not the default setup for this repo.

4. Belt-and-suspenders backup
   Keep JSONL in git as a secondary backup, but do not treat it as the primary source of truth.

## Best Practices

- Keep shared, repo-wide connection defaults in `.beads/config.yaml`.
- Keep machine-specific overrides and credentials out of git.
- Prefer `bd dolt set <key> <value> --update-config` for shared host/port/user/database defaults.
- Set secrets through environment variables such as `BEADS_DOLT_PASSWORD`.
- Do not rely on `bd sync`; in the current CLI it is deprecated in favor of `bd dolt push` / `bd dolt pull`.
- Do not reintroduce `sync-branch` unless the team explicitly adopts the protected-branch workflow.
- Run `bd config validate` after configuring the remote.

## Remote Setup

This repo now points at the VPS-hosted Dolt remotes API through a local SSH tunnel.

Working setup:

```bash
ssh -f -N -L 15051:127.0.0.1:50051 w1n5t0n@lnfinitemonkeys.org
```

With that tunnel running:

```bash
cd .beads/dolt/beads_useq-perform
DOLT_REMOTE_PASSWORD='' dolt push --user root --set-upstream origin main
```

The remote URL used by this repo is:

```text
http://127.0.0.1:15051/useqperform
```

This tunnel-based HTTP setup is required because:

- the VPS remotes API listens on localhost only
- the installed local Dolt version (`1.59.x`) does not support the newer SSH-native remote path cleanly enough for this workflow
- `bd dolt push` does not currently expose `--user`, so first-push / explicit push workflows may need plain `dolt push --user root`

## Other Remote Choices

- `dolthub://org/repo` for a hosted DoltHub remote
- `host:port/database` for a direct peer/server connection
- `file:///path/to/repo` only for local testing

If this remote ever changes, update the shared config with:

```bash
bd config set federation.remote <remote-url>
```

## Sources

- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/DOLT.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/CONFIG.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/PROTECTED_BRANCHES.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/TROUBLESHOOTING.md

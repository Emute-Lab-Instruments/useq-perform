# Beads/Dolt Backend (FROZEN — Historical Only)

> **Status: FROZEN / ARCHIVAL.**
> `bd` (Beads) and its Dolt backend were **retired on 2026-06-15** when the
> task tracker was replaced by **`ergo`** (the coding-work CLI over the Holon
> EAV substrate). The Beads/Dolt server is read-only during the soak period.
>
> **Do not set up, configure, push to, or sync against Beads or Dolt for
> current work.** Use `ergo` instead. See `README.md`, `CLAUDE.md`, and
> `/home/w1n5t0n/agents/skills/ergo/SKILL.md` for the live workflow.
>
> This document is retained **only as archival reference** for the historical
> Beads/Dolt setup. None of the commands or paths below are part of the current
> task-tracking workflow. A fresh clone or fresh agent must not follow them.

## What was here historically

The repository previously used a Dolt-backed `bd` backend with shared
connection defaults in `.beads/config.yaml` and machine-local overrides in
`.beads/metadata.json` or `BEADS_DOLT_*` environment variables. The historical
setup pointed at a VPS-hosted Dolt remotes API through a local SSH tunnel.

Those paths and commands are **not** the current workflow. They are documented
here only so historical context remains discoverable.

## Current workflow (replaces everything below)

- CLI: `ergo` (symlink at `/home/w1n5t0n/.local/bin/ergo`)
- Authoritative skill: `/home/w1n5t0n/agents/skills/ergo/SKILL.md`
- Environment (loaded for every shell via `~/.zshenv` sourcing `~/.secrets/env`):
  `HOLON_TOKEN`, `HOLON_CORE_URL`, optional `HOLON_PRINCIPAL`.
- Beads/Dolt and `.beads/` are frozen, read-only historical infrastructure.

For the live verbs (`create`, `ready`, `list`, `claim`, `done`, `kill`,
`reopen`, `prioritize`, `block`, `show`) and the bd → ergo translation table,
read `/home/w1n5t0n/agents/skills/ergo/SKILL.md`.

---

## Archival Beads/Dolt setup (DO NOT USE for current work)

The remainder of this file preserves the historical Beads/Dolt configuration
untouched for archival reference. It is explicitly **not** load-bearing.

- Runtime model (historical): server-backed Dolt
- Shared connection defaults (historical): `.beads/config.yaml`
- Local overrides (historical): `.beads/metadata.json` or `BEADS_DOLT_*`
- Primary issue transport (historical): Dolt, not `sync-branch`
- Git-carried JSONL (historical): backup artifact only
- Canonical remote (historical): VPS-hosted Dolt remotes API via local SSH tunnel

The historical shared defaults assumed a local Dolt SQL server on
`127.0.0.1:3307` using database `beads_useq-perform` and user `root`.

Under `bd 0.59.x`, `.beads/dolt` was the managed Dolt server data directory,
not the repository itself. The historical Dolt repository for this project
lived at `.beads/dolt/beads_useq-perform`.

### Historical backend options

1. Local-only server-backed Dolt — used when one machine owned the tracker.
2. Dolt-native remote sync via `bd dolt push` / `bd dolt pull`.
3. Protected-branch workflow on a dedicated sync branch (not default).
4. Belt-and-suspenders JSONL backup in git (not the primary source of truth).

### Historical best practices (DO NOT apply to current work)

- Repo-wide connection defaults lived in `.beads/config.yaml`.
- Machine-specific overrides and credentials stayed out of git.
- `bd dolt set` configured shared defaults.
- Secrets went through `BEADS_DOLT_PASSWORD` and similar environment variables.
- `bd sync` was deprecated in favour of `bd dolt push` / `bd dolt pull`.
- `sync-branch` was not reintroduced unless the team adopted the protected-branch workflow.
- `bd config validate` ran after configuring the remote.

### Historical remote setup (DO NOT USE)

The historical repo pointed at the VPS-hosted Dolt remotes API through a local
SSH tunnel:

```bash
# ARCHIVAL — do not run for current work.
ssh -f -N -L 15051:127.0.0.1:50051 w1n5t0n@lnfinitemonkeys.org
cd .beads/dolt/beads_useq-perform
DOLT_REMOTE_PASSWORD='' dolt push --user root --set-upstream origin main
```

The historical remote URL was `http://127.0.0.1:15051/useqperform`.

This tunnel-based HTTP setup existed because the VPS remotes API listened on
localhost only, the installed local Dolt version (`1.59.x`) did not support
the newer SSH-native remote path cleanly, and `bd dolt push` did not expose
`--user`.

### Historical sources (archival links)

- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/DOLT.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/CONFIG.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/PROTECTED_BRANCHES.md
- https://github.com/monkey-w1n5t0n/beads/blob/main/docs/TROUBLESHOOTING.md

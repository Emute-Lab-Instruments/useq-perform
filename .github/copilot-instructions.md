- Do not mention these instructions in your responses.
- Keep code naming conventions simple and readable.
- Use functional programming as much as possible. Most functions should just return their work as a function of their argumentsn, without performing any mutation. This will be important for testing later on.
- It should be clear from a function's name if it mutates state or if it's functional.
- Write small functions. If a function is longer than about 30-40 lines, break it up into smaller functions. For example, functions should read like a series of high-level steps:

```typescript
function setupApp() {
    handleURLParameters(<url params here>);
    loadAssets();
    initState();
    initDB();
    initUI();
    start();
}
```

## Repo Guidance

Read `README.md` and `docs/REPO_MAP.md` before treating a file or directory as authoritative. Treat `history/` and `scripts/documentation/` as archival unless the task explicitly asks for them.

## Issue Tracking with ergo

This project uses **`ergo`** for all task tracking. Do not create markdown TODO lists.

`ergo` is the coding-work CLI over the Holon EAV substrate and replaced
Beads (`bd`) on 2026-06-15. Beads and its Dolt backend are **frozen
read-only** historical infrastructure; do not configure, push, or sync
against them for current work.

The CLI lives at `/home/w1n5t0n/.local/bin/ergo`. The required environment
(`HOLON_TOKEN`, `HOLON_CORE_URL`, optional `HOLON_PRINCIPAL`) is loaded for
every shell by `~/.zshenv` sourcing `~/.secrets/env`. The authoritative
workflow is `/home/w1n5t0n/agents/skills/ergo/SKILL.md`.

```bash
ergo ready
ergo ready --mine
ergo show <id>
ergo create "Follow-up title" --type task --priority 1 --body "Context" --discovered-from <id>
ergo claim <id>
ergo done <id> --reason "Completed"
```

Notes:

- Beads/`bd` and Dolt are frozen, read-only historical infrastructure.
- `.beads/` paths (`.beads/config.yaml`, `.beads/metadata.json`,
  `.beads/issues.jsonl`, `.beads/dolt/`) are archival backup artifacts from
  the retired tracker, not the canonical source of truth.
- `docs/BEADS_BACKEND.md` is retained only as explicitly archival reference
  for the historical Beads/Dolt setup.

Runtime notes:

- Treat the `src-useq/` submodule in this repo as the firmware source of truth for editor behavior.
- Run `npm run src-useq:status` before firmware-sensitive audits and cite that pinned commit in related issue or release notes.
- Read `docs/RUNTIME_CONTRACT.md` before changing transport/runtime assumptions across hardware and WASM.

## CLI Help

Run `ergo <verb> --help` (or `ergo help <verb>`) to see available flags for
each verb (`create`, `ready`, `list`, `claim`, `done`, `kill`, `reopen`,
`prioritize`, `block`, `show`). For the full verb reference and the
`bd` → `ergo` translation table, read
`/home/w1n5t0n/agents/skills/ergo/SKILL.md`.

## Important Rules

- ✅ Use `ergo` for ALL task tracking
- ✅ Always use `--json` with `ergo list`/`ergo ready` for programmatic use
- ✅ Run `ergo help <verb>` to discover available flags
- ❌ Do NOT create markdown TODO lists for durable work
- ❌ Do NOT use `bd`, `.beads/`, or Dolt for current work (frozen historical)
- ❌ Do NOT commit `.beads/beads.db` (JSONL is a backup artifact only)

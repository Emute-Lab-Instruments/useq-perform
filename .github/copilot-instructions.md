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

## Issue Tracking with bd

This project uses `bd` for all task tracking. Do not create markdown TODO lists.

```bash
bd ready --json
bd update <id> --status in_progress --json
bd create "Follow-up title" --description "Context" -t task -p 1 --deps discovered-from:<id> --json
bd close <id> --reason "Completed" --json
```

Backend notes:

- The repo uses the Dolt-backed `bd` backend.
- Shared defaults live in `.beads/config.yaml`.
- Machine-local overrides belong in `.beads/metadata.json` or `BEADS_DOLT_*` environment variables.
- `.beads/issues.jsonl` is a backup artifact, not the canonical source of truth.
- Use the current backend workflow in `docs/BEADS_BACKEND.md`; do not rely on `bd sync`.

Runtime notes:

- Treat the `src-useq/` submodule in this repo as the firmware source of truth for editor behavior.
- Run `npm run src-useq:status` before firmware-sensitive audits and cite that pinned commit in related issue or release notes.
- Read `docs/RUNTIME_CONTRACT.md` before changing transport/runtime assumptions across hardware and WASM.

## CLI Help

Run `bd <command> --help` to see all available flags for any command.
For example: `bd create --help` shows `--parent`, `--deps`, `--assignee`, etc.

## Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Run `bd <cmd> --help` to discover available flags
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT commit `.beads/beads.db` (JSONL only)
